/**
 * sendExpiryReminders — the orchestration around the two database steps (list who is due, claim one).
 *
 * WHICH POSTINGS ARE DUE is decided in SQL (due_job_expiry_reminders / claim_job_expiry_reminder) and is tested against
 * a real database in expiry-reminders-db.test.ts. What is tested here is everything the TypeScript owns: it claims
 * BEFORE it sends, sends only for a claim it won, puts the raw token (never the hash) in the email, releases its own
 * claim when the send fails so the next run retries, and sends nothing when the claim is lost.
 *
 * NOTHING HERE TOUCHES A REAL MAILER OR DATABASE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Due = { job_posting_id: string; title: string; organization_id: string; closes_at: string };

const state = vi.hoisted(() => ({
  mailer: true,
  sendFails: false,
  due: [] as Array<{ job_posting_id: string; title: string; organization_id: string; closes_at: string }>,
  claims: new Set<string>(),
  claimedHashes: [] as string[],
  sent: [] as Array<{ to: string; subject: string; text: string; html: string }>,
  stamped: [] as string[],
  released: [] as string[],
  owners: {} as Record<string, string[]>,
  profiles: {} as Record<string, { email: string | null; first_name: string | null; deletion_requested_at?: string | null }>,
  orgCreator: {} as Record<string, string>,
  dueError: null as string | null,
  listIgnoresClaims: false,
}));

vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () =>
    state.mailer
      ? {
          emails: {
            send: async (p: { to: string; subject: string; text: string; html: string }) => {
              if (state.sendFails) throw new Error("resend down");
              state.sent.push(p);
              return { data: { id: "x" }, error: null };
            },
          },
        }
      : null,
}));
vi.mock("@/lib/seo/site", () => ({ absoluteUrl: (p: string) => `https://talentrah.test${p}` }));

function builder(table: string) {
  const f: Record<string, unknown> = {};
  let op: "select" | "update" | "delete" = "select";
  let payload: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.update = (p: Record<string, unknown>) => ((op = "update"), (payload = p), b);
  b.delete = () => ((op = "delete"), b);
  for (const m of ["eq", "is", "in"]) b[m] = (col: string, v: unknown) => ((f[col] = v), b);
  b.maybeSingle = async () => resolve();
  b.then = (res: (v: unknown) => unknown) => res(resolve());
  function resolve() {
    if (table === "job_expiry_reminders") {
      if (op === "update" && "sent_at" in payload) state.stamped.push(f.token_hash as string);
      if (op === "delete") state.released.push(f.token_hash as string);
      return { data: null, error: null };
    }
    if (table === "organization_members") {
      return { data: (state.owners[f.organization_id as string] ?? []).map((user_id) => ({ user_id })), error: null };
    }
    if (table === "organizations") {
      const id = f.id as string;
      return { data: state.orgCreator[id] ? { created_by: state.orgCreator[id] } : null, error: null };
    }
    if (table === "profiles") {
      const ids = (f.id as string[] | string) ?? [];
      const list = Array.isArray(ids) ? ids : [ids];
      return {
        data: list.filter((id) => state.profiles[id]).map((id) => ({ id, ...state.profiles[id] })),
        error: null,
      };
    }
    return { data: [], error: null };
  }
  return b;
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "due_job_expiry_reminders") {
        if (state.dueError) return { data: null, error: { message: state.dueError } };
        return {
          data: state.listIgnoresClaims
            ? state.due
            : state.due.filter((d) => !state.claims.has(`${d.job_posting_id}|${d.closes_at}`)),
          error: null,
        };
      }
      if (name === "claim_job_expiry_reminder") {
        const d = state.due.find((x) => x.job_posting_id === args.p_job_posting_id);
        if (!d) return { data: [], error: null };
        const key = `${d.job_posting_id}|${d.closes_at}`;
        if (state.claims.has(key)) return { data: [], error: null };
        state.claims.add(key);
        state.claimedHashes.push(args.p_token_hash as string);
        return { data: [{ closes_at: d.closes_at }], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => builder(table),
  }),
}));

import { sendExpiryReminders } from "@/lib/jobs/expiry-reminders/send";

const NOW = new Date("2026-10-02T19:00:00.000Z");
const due = (id: string, org = "org-1"): Due => ({
  job_posting_id: id,
  title: `Role ${id}`,
  organization_id: org,
  closes_at: "2026-10-05T12:00:00.000Z",
});

beforeEach(() => {
  state.mailer = true;
  state.sendFails = false;
  state.due = [];
  state.claims = new Set();
  state.claimedHashes = [];
  state.sent = [];
  state.stamped = [];
  state.released = [];
  state.owners = { "org-1": ["u1"] };
  state.profiles = { u1: { email: "owner@acme.test", first_name: "Ada" } };
  state.orgCreator = { "org-1": "u1" };
  state.dueError = null;
  state.listIgnoresClaims = false;
});

describe("the happy path", () => {
  it("claims, then emails the owner once, with the raw token in the link and only its hash stored", async () => {
    state.due = [due("job-a")];
    const summary = await sendExpiryReminders(NOW);

    expect(summary).toMatchObject({ considered: 1, sent: 1, failed: 0 });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toBe("owner@acme.test");
    expect(state.sent[0].text).toContain("Role job-a");
    expect(state.sent[0].text).toContain("5 Oct 2026");

    const link = state.sent[0].text.match(/https:\/\/talentrah\.test\/extend-posting\/([A-Za-z0-9_-]+)/);
    expect(link, "the email must carry the extend link").not.toBeNull();
    const rawToken = link![1];
    expect(state.claimedHashes).toHaveLength(1);
    expect(state.claimedHashes[0]).not.toBe(rawToken);
    expect(state.claimedHashes[0]).toMatch(/^[0-9a-f]{64}$/);
    // …and the claim is stamped as sent against that hash.
    expect(state.stamped).toEqual(state.claimedHashes);
  });

  it("two runs in a row send once", async () => {
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    const second = await sendExpiryReminders(new Date(NOW.getTime() + 60_000));
    expect(state.sent).toHaveLength(1);
    expect(second.sent).toBe(0);
  });

  it("emails every owner of the organisation, once each", async () => {
    state.owners = { "org-1": ["u1", "u2"] };
    state.profiles = {
      u1: { email: "owner@acme.test", first_name: "Ada" },
      u2: { email: "second@acme.test", first_name: null },
    };
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent.map((m) => m.to).sort()).toEqual(["owner@acme.test", "second@acme.test"]);
  });

  it("falls back to the organisation's creator when it has no owner membership row", async () => {
    state.owners = {};
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent.map((m) => m.to)).toEqual(["owner@acme.test"]);
  });
});

describe("who gets the email: nobody ineligible, and no claim is left behind when nobody is", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  beforeEach(() => info.mockClear());

  /** The posting is skipped: nothing sent, nothing CLAIMED (so a later run is free to retry), and the reason is logged. */
  async function expectSkipped(reason: string) {
    state.due = [due("job-a")];
    const summary = await sendExpiryReminders(NOW);
    expect(state.sent).toHaveLength(0);
    expect(state.claimedHashes, "a posting with no eligible recipient must not be claimed").toHaveLength(0);
    expect(state.claims.size).toBe(0);
    expect(summary).toMatchObject({ considered: 1, sent: 0, failed: 0, skipped: 1 });
    const logged = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("job-a");
    expect(logged).toContain(reason);
  }

  it("a deleted user (no profile row any more) is skipped", async () => {
    state.profiles = {};
    await expectSkipped("deleted");
  });

  it("a user with no email is skipped", async () => {
    state.profiles = { u1: { email: null, first_name: null } };
    await expectSkipped("no_email");
  });

  it("an ineligible owner is skipped but the eligible one is still emailed", async () => {
    state.owners = { "org-1": ["u1", "u2"] };
    state.profiles = {
      u1: { email: null, first_name: null },
      u2: { email: "second@acme.test", first_name: "Bo" },
    };
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent.map((m) => m.to)).toEqual(["second@acme.test"]);
  });

  it("a posting skipped for want of a recipient is retried on the next run, and sends once a recipient exists", async () => {
    state.profiles = {};
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent).toHaveLength(0);

    state.profiles = { u1: { email: "owner@acme.test", first_name: "Ada" } };
    const next = await sendExpiryReminders(new Date(NOW.getTime() + 24 * 3_600_000));
    expect(next.sent).toBe(1);
    expect(state.sent.map((m) => m.to)).toEqual(["owner@acme.test"]);
  });
});

describe("accounts scheduled for deletion (ACCT-1)", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  beforeEach(() => info.mockClear());
  const PENDING = "2026-10-02T12:00:00Z";

  it("a pending owner gets no reminder, and the organisation's creator (a different, eligible person) is emailed instead", async () => {
    state.owners = { "org-1": ["u1"] };
    state.orgCreator = { "org-1": "u2" };
    state.profiles = {
      u1: { email: "owner@acme.test", first_name: "Ada", deletion_requested_at: PENDING },
      u2: { email: "creator@acme.test", first_name: "Cy" },
    };
    state.due = [due("job-a")];
    const summary = await sendExpiryReminders(NOW);
    expect(state.sent.map((m) => m.to)).toEqual(["creator@acme.test"]);
    expect(summary).toMatchObject({ sent: 1, skipped: 0 });
  });

  it("with two owners, the pending one is dropped and the other is still emailed (no need to fall back)", async () => {
    state.owners = { "org-1": ["u1", "u2"] };
    state.orgCreator = { "org-1": "u3" };
    state.profiles = {
      u1: { email: "owner@acme.test", first_name: "Ada", deletion_requested_at: PENDING },
      u2: { email: "second@acme.test", first_name: "Bo" },
      u3: { email: "creator@acme.test", first_name: "Cy" },
    };
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent.map((m) => m.to)).toEqual(["second@acme.test"]);
  });

  it("when the only owner is pending and nobody else can be mailed, the posting is skipped WITHOUT a claim, and the reason says why", async () => {
    state.owners = { "org-1": ["u1"] };
    state.orgCreator = { "org-1": "u1" };
    state.profiles = { u1: { email: "owner@acme.test", first_name: "Ada", deletion_requested_at: PENDING } };
    state.due = [due("job-a")];
    const summary = await sendExpiryReminders(NOW);
    expect(state.sent).toHaveLength(0);
    expect(state.claims.size).toBe(0);
    expect(summary).toMatchObject({ considered: 1, sent: 0, skipped: 1 });
    expect(info.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("deleted_pending");
  });

  it("a pending owner AND a pending creator: skipped, never claimed", async () => {
    state.owners = { "org-1": ["u1"] };
    state.orgCreator = { "org-1": "u2" };
    state.profiles = {
      u1: { email: "owner@acme.test", first_name: "Ada", deletion_requested_at: PENDING },
      u2: { email: "creator@acme.test", first_name: "Cy", deletion_requested_at: PENDING },
    };
    state.due = [due("job-a")];
    const summary = await sendExpiryReminders(NOW);
    expect(state.sent).toHaveLength(0);
    expect(state.claims.size).toBe(0);
    expect(summary.skipped).toBe(1);
    // Nobody to write to is not an error: nothing failed, so the run is not retried or alarmed for it.
    expect(summary.failed).toBe(0);
  });

  it("once the owner restores the account (flag cleared) the next run sends to them again", async () => {
    state.owners = { "org-1": ["u1"] };
    state.orgCreator = { "org-1": "u1" };
    state.profiles = { u1: { email: "owner@acme.test", first_name: "Ada", deletion_requested_at: PENDING } };
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent).toHaveLength(0);
    state.profiles = { u1: { email: "owner@acme.test", first_name: "Ada", deletion_requested_at: null } };
    const next = await sendExpiryReminders(new Date(NOW.getTime() + 24 * 3_600_000));
    expect(next.sent).toBe(1);
  });
});

describe("eligibility is exactly 'the profile exists and the email is not blank' (nothing else is pretended)", () => {
  it("a profile carrying fields this code does not know about is still emailed", async () => {
    state.profiles = {
      u1: { email: "owner@acme.test", first_name: "Ada", deactivated_at: "2026-10-01T00:00:00Z" } as never,
    };
    state.due = [due("job-a")];
    await sendExpiryReminders(NOW);
    expect(state.sent.map((m) => m.to)).toEqual(["owner@acme.test"]);
  });
});

describe("failure handling", () => {
  it("a failed send releases its OWN claim, so the next run retries", async () => {
    state.due = [due("job-a")];
    state.sendFails = true;
    const summary = await sendExpiryReminders(NOW);
    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(state.released).toEqual(state.claimedHashes);
    expect(state.stamped).toHaveLength(0);
  });

  it("a claim lost to another run sends nothing", async () => {
    state.due = [due("job-a")];
    // "Listed, then lost the race": the listing still shows it, but another run already holds the claim.
    state.listIgnoresClaims = true;
    state.claims.add("job-a|2026-10-05T12:00:00.000Z");
    const summary = await sendExpiryReminders(NOW);
    expect(state.sent).toHaveLength(0);
    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(0); // losing a claim is not a failure
    expect(state.released).toHaveLength(0); // and it must not release the OTHER run's claim
  });

  it("mailer not configured: nothing claimed, says why", async () => {
    state.mailer = false;
    state.due = [due("job-a")];
    const summary = await sendExpiryReminders(NOW);
    expect(summary.reason).toMatch(/mailer/i);
    expect(state.claimedHashes).toHaveLength(0);
  });

  it("a failing listing is reported, not swallowed", async () => {
    state.dueError = "boom";
    const summary = await sendExpiryReminders(NOW);
    expect(summary.reason).toBe("boom");
  });

  it("nothing due: nothing sent", async () => {
    const summary = await sendExpiryReminders(NOW);
    expect(summary).toMatchObject({ considered: 0, sent: 0, failed: 0 });
    expect(state.sent).toHaveLength(0);
  });
});
