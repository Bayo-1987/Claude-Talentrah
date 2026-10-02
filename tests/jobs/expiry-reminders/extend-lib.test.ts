/**
 * redeemExtendToken / peekExtendToken — the TypeScript side of the extend link. The atomic part is SQL
 * (redeem_job_expiry_extend_token) and is tested against a real database in expiry-reminders-db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  reminder: null as null | Record<string, unknown>,
  job: null as null | Record<string, unknown>,
  hashes: [] as string[],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: db.rpc,
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, v: string) => {
        if (col === "token_hash") db.hashes.push(v);
        return b;
      };
      b.maybeSingle = async () => ({ data: table === "job_expiry_reminders" ? db.reminder : db.job, error: null });
      return b;
    },
  }),
}));

import { hashExtendToken } from "@/lib/jobs/expiry-reminders/token";
import { peekExtendToken, redeemExtendToken } from "@/lib/jobs/expiry-reminders/extend";

const TOKEN = "b".repeat(43);
const NOW = new Date("2026-10-03T12:00:00.000Z");

beforeEach(() => {
  db.rpc.mockReset();
  db.reminder = null;
  db.job = null;
  db.hashes = [];
});

describe("redeemExtendToken", () => {
  it("sends only the HASH to the database, with the caller's clock", async () => {
    db.rpc.mockResolvedValue({
      data: [{ outcome: "extended", job_posting_id: "j1", title: "T", new_expires_at: "2026-11-04T12:00:00.000Z" }],
      error: null,
    });
    const out = await redeemExtendToken(TOKEN, NOW);
    expect(db.rpc).toHaveBeenCalledWith("redeem_job_expiry_extend_token", {
      p_token_hash: hashExtendToken(TOKEN),
      p_now: NOW.toISOString(),
    });
    expect(out).toEqual({ outcome: "extended", jobId: "j1", title: "T", newExpiresAt: "2026-11-04T12:00:00.000Z" });
  });

  it.each(["used", "expired", "invalid", "unavailable"])("maps %s", async (outcome) => {
    db.rpc.mockResolvedValue({ data: [{ outcome, job_posting_id: null, title: null, new_expires_at: null }], error: null });
    expect(await redeemExtendToken(TOKEN, NOW)).toMatchObject({ outcome });
  });

  it("a token of the wrong shape is invalid without touching the database", async () => {
    for (const bad of ["", "short", "x".repeat(44), "has spaces " + "a".repeat(32), "../etc/passwd"]) {
      expect(await redeemExtendToken(bad, NOW)).toEqual({ outcome: "invalid" });
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a database error is an error, never an extension", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await redeemExtendToken(TOKEN, NOW)).toEqual({ outcome: "error" });
  });
});

describe("peekExtendToken (read-only)", () => {
  it("is ready for an unused, unexpired link to an open employer posting, and never calls the redeem function", async () => {
    db.reminder = { job_posting_id: "j1", closes_at: "2026-10-05T12:00:00.000Z", used_at: null, sent_at: "2026-10-02T19:00:00Z" };
    db.job = { id: "j1", title: "Backend Engineer", status: "open", source_type: "internal", expires_at: "2026-10-05T12:00:00.000Z" };
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({
      state: "ready",
      jobId: "j1",
      title: "Backend Engineer",
      closesAt: "2026-10-05T12:00:00.000Z",
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.hashes).toEqual([hashExtendToken(TOKEN)]);
  });

  it("unknown token: invalid", async () => {
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "invalid" });
  });

  it("used", async () => {
    db.reminder = { job_posting_id: "j1", closes_at: "2026-10-05T12:00:00.000Z", used_at: "2026-10-03T00:00:00Z", sent_at: "x" };
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "used" });
  });

  it("expired once the closing date has passed", async () => {
    db.reminder = { job_posting_id: "j1", closes_at: "2026-10-03T11:59:59.000Z", used_at: null, sent_at: "x" };
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "expired" });
  });

  it.each([
    ["closed", "internal"],
    ["removed", "internal"],
    ["draft", "internal"],
    ["open", "external"],
  ])("unavailable for a %s %s posting", async (status, source_type) => {
    db.reminder = { job_posting_id: "j1", closes_at: "2026-10-05T12:00:00.000Z", used_at: null, sent_at: "x" };
    db.job = { id: "j1", title: "T", status, source_type, expires_at: "2026-10-05T12:00:00.000Z" };
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "unavailable" });
  });

  it("malformed token: invalid without a query", async () => {
    expect(await peekExtendToken("nope", NOW)).toEqual({ state: "invalid" });
    expect(db.hashes).toEqual([]);
  });
});
