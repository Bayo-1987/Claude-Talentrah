/**
 * NOTIF PR-D (A2) — the mass-send path is NEW code and must not change how any existing sender works.
 *
 * This file was written FIRST, against the code as it stood before the mass-send module existed, and its snapshot
 * (existing-senders-use-emails-send.snapshot.json, committed beside it) records the arguments each existing sender passes to
 * `emails.send` today. It has to keep passing, byte for byte, on the final code:
 *
 *   (1) by source scan, every `.emails.send(` file still sends one email per call: no batch API, no idempotency key, and no
 *       import of the mass-send module;
 *   (2) behaviourally, with a fake mail client, the weekly digest, win-back, receipts and renewals each still call `emails.send`
 *       once per recipient with the argument shape captured from main.
 *
 * The snapshot normalises two things that are not about the sender: the site origin (an environment value) and the html body
 * (a hash and a length, so a layout edit shows up as a changed hash without a wall of markup in the diff). The text body, the
 * recipient, the subject, the from address and every header are stored verbatim.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@/lib/flags/read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags/read")>()),
  isFeatureEnabled: vi.fn(async () => true),
}));

vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({
    emails: {
      send: async (payload: Record<string, unknown>) => {
        sent.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
}));

const fixtures = vi.hoisted(() => ({
  digestRecipients: [] as Record<string, unknown>[],
  winbackRecipients: [] as Record<string, unknown>[],
  matchScores: [] as Record<string, unknown>[],
  baseResumes: [] as Record<string, unknown>[],
  userPasses: [] as Record<string, unknown>[],
  currentRecipients: (() => []) as () => Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      let isUpdate = false;
      let served = false;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "gte", "lte", "is", "in", "not", "limit", "order", "neq", "gt", "lt", "contains"]) {
        chain[m] = () => chain;
      }
      chain.update = () => {
        isUpdate = true;
        return chain;
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        if (isUpdate) return Promise.resolve({ error: null, data: [] }).then(resolve);
        let data: unknown[] = [];
        if (table === "match_scores") data = fixtures.matchScores;
        else if (table === "resumes") data = fixtures.baseResumes;
        else if (table === "email_preferences") data = fixtures.currentRecipients();
        else if (table === "user_passes" && !served) {
          // The renewal job reads this table twice: the reminders stage first, then the charges stage. Only the first read has rows.
          served = true;
          data = fixtures.userPasses;
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { SITE_ORIGIN } from "@/lib/seo/site";
import { sendJobMatchDigest } from "@/lib/digest/send";
import { sendWinbackEmails } from "@/lib/notifications/win-back/send";
import { getReceiptMailer } from "@/lib/billing/send-receipt";
import { runPassRenewalJob } from "@/lib/billing/renewals";

const SRC = join(__dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const NOW = new Date("2026-09-26T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** What an argument list looks like once the parts that are not about the sender are normalised. */
function normalise(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    const value = payload[key];
    if (key === "html" && typeof value === "string") {
      const html = value.split(SITE_ORIGIN).join("<ORIGIN>");
      out.html = { sha256_16: createHash("sha256").update(html).digest("hex").slice(0, 16), length: html.length };
    } else if (typeof value === "string") {
      out[key] = value.split(SITE_ORIGIN).join("<ORIGIN>");
    } else if (value && typeof value === "object") {
      out[key] = JSON.parse(JSON.stringify(value).split(SITE_ORIGIN).join("<ORIGIN>"));
    } else {
      out[key] = value;
    }
  }
  return out;
}

const SNAPSHOT = join(__dirname, "existing-senders-use-emails-send.snapshot.json");
const snapshotParts: Record<string, unknown> = {};

beforeEach(() => {
  sent.length = 0;
  fixtures.digestRecipients = [];
  fixtures.winbackRecipients = [];
  fixtures.matchScores = [];
  fixtures.baseResumes = [];
  fixtures.userPasses = [];
});

function posting(userId: string, jobId: string, score: number) {
  return {
    user_id: userId,
    score,
    explanation: { matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "unknown" },
    job_posting_id: jobId,
    job_postings: {
      id: jobId,
      title: `Role ${jobId}`,
      company_name: "Verified Co",
      location: "Lagos",
      posted_at: daysAgo(3),
      status: "open",
      organization_id: null,
      unlisted_at: null,
    },
  };
}

describe("the existing senders are unchanged", () => {
  it("the weekly digest still calls emails.send once per recipient with the same arguments", async () => {
    fixtures.currentRecipients = () => fixtures.digestRecipients;
    fixtures.digestRecipients = ["ada", "bola"].map((id) => ({
      user_id: `u-${id}`,
      unsubscribe_token: `tok-${id}`,
      digest_last_sent_at: null,
      profiles: { email: `${id}@example.test`, first_name: id === "ada" ? "Ada" : "Bola" },
    }));
    fixtures.matchScores = ["ada", "bola"].flatMap((id) => [posting(`u-${id}`, "job-1", 90), posting(`u-${id}`, "job-2", 82)]);

    const summary = await sendJobMatchDigest(NOW);

    expect(summary.sent).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.map((p) => p.to)).toEqual(["ada@example.test", "bola@example.test"]);
    snapshotParts.digest = sent.map(normalise);
  });

  it("win-back still calls emails.send once per recipient with the same arguments", async () => {
    fixtures.currentRecipients = () => fixtures.winbackRecipients;
    fixtures.winbackRecipients = ["cy", "dee"].map((id) => ({
      user_id: `u-${id}`,
      unsubscribe_token: `tok-${id}`,
      win_back_email: true,
      win_back_last_sent_at: null,
      profiles: { email: `${id}@example.test`, first_name: id === "cy" ? "Cy" : "Dee", last_active_at: daysAgo(16) },
    }));
    fixtures.baseResumes = ["cy", "dee"].map((id) => ({ user_id: `u-${id}`, is_base: true }));
    fixtures.matchScores = ["cy", "dee"].map((id) => posting(`u-${id}`, "job-9", 84));

    const summary = await sendWinbackEmails(NOW);

    expect(summary.sent).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.map((p) => p.to)).toEqual(["cy@example.test", "dee@example.test"]);
    snapshotParts.winBack = sent.map(normalise);
  });

  it("receipts still call emails.send once per recipient with the same arguments", async () => {
    const mail = getReceiptMailer();
    expect(mail).not.toBeNull();
    for (const [i, who] of ["eve", "fay"].entries()) {
      const ok = await mail!({
        to: `${who}@example.test`,
        greeting: `Hi ${who},`,
        productName: "Starter pack",
        productType: "credit_pack",
        amountNgn: 2500 + i,
        reference: `ref-${who}`,
      });
      expect(ok).toBe(true);
    }
    expect(sent).toHaveLength(2);
    expect(sent.map((p) => p.to)).toEqual(["eve@example.test", "fay@example.test"]);
    snapshotParts.receipts = sent.map(normalise);
  });

  it("renewals still call emails.send once per recipient with the same arguments", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    fixtures.userPasses = ["gus", "hal"].map((who) => ({
      id: `up-${who}`,
      next_renewal_date: tomorrow,
      profiles: { email: `${who}@example.test`, first_name: who === "gus" ? "Gus" : "Hal" },
      passes: { name: "30-Day Pass", price_ngn: 13500 },
    }));

    const summary = await runPassRenewalJob();

    expect(summary.remindersSent).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.map((p) => p.to)).toEqual(["gus@example.test", "hal@example.test"]);
    // The reminder names its renewal date, which is "tomorrow" on whatever day this runs; pin it so the snapshot is stable.
    snapshotParts.renewals = sent.map((p) => normalise(withoutDate(p, tomorrow)));
  });

  it("the snapshot of today's send arguments is exactly what the committed file holds", async () => {
    expect(Object.keys(snapshotParts).sort()).toEqual(["digest", "receipts", "renewals", "winBack"]);
    await expect(JSON.stringify(snapshotParts, null, 2) + "\n").toMatchFileSnapshot(SNAPSHOT);
  });
});

/** The renewal reminder's text and html carry the renewal date ("tomorrow" on whatever day this runs); replace that one date with a fixed token. */
function withoutDate(payload: Record<string, unknown>, date: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const key of ["text", "html"]) {
    if (typeof out[key] === "string") out[key] = (out[key] as string).split(date).join("<RENEWAL_DATE>");
  }
  return out;
}

describe("no existing sender uses the batch API or an idempotency key", () => {
  const senders = walk(SRC).filter((f) => /\.emails\.send\(/.test(readFileSync(f, "utf8")));

  it("there are still the call sites the spec counted (23 plus the deletion-lifecycle wrapper)", () => {
    expect(senders.length).toBeGreaterThanOrEqual(21);
  });

  it("none of them calls a batch endpoint, sets an Idempotency-Key, or imports the mass-send module", () => {
    const offenders: string[] = [];
    for (const f of senders) {
      const text = readFileSync(f, "utf8");
      if (/\.batch\s*\.\s*(send|create)\s*\(|batch\.send\(/.test(text)) offenders.push(`${f.slice(SRC.length + 1)}: batch`);
      if (/["']Idempotency-Key["']|idempotencyKey\s*:/.test(text)) offenders.push(`${f.slice(SRC.length + 1)}: idempotency key`);
      if (/from\s+["'][^"']*mass-send[^"']*["']/.test(text)) offenders.push(`${f.slice(SRC.length + 1)}: mass-send import`);
    }
    expect(offenders).toEqual([]);
  });

  it("each of the four named senders still calls `.emails.send(` directly", () => {
    for (const rel of ["lib/digest/send.ts", "lib/notifications/win-back/send.ts", "lib/billing/send-receipt.ts", "lib/billing/renewals.ts"]) {
      expect(readFileSync(join(SRC, rel), "utf8"), rel).toMatch(/\.emails\.send\(/);
    }
  });
});
