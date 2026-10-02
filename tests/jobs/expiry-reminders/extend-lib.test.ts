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
const DAY = 86_400_000;

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

  it("'used' carries the CURRENT closing date and the title, so the page can say 'already extended' truthfully", async () => {
    db.rpc.mockResolvedValue({
      data: [{ outcome: "used", job_posting_id: "j1", title: "T", new_expires_at: "2026-12-02T12:00:00.000Z" }],
      error: null,
    });
    expect(await redeemExtendToken(TOKEN, NOW)).toEqual({
      outcome: "used",
      jobId: "j1",
      title: "T",
      closesAt: "2026-12-02T12:00:00.000Z",
    });
  });

  it.each(["expired", "closed", "no_closing_date"])("maps %s", async (outcome) => {
    db.rpc.mockResolvedValue({ data: [{ outcome, job_posting_id: "j1", title: null, new_expires_at: null }], error: null });
    expect(await redeemExtendToken(TOKEN, NOW)).toMatchObject({ outcome });
  });

  it("an outcome the code does not know is invalid, never an extension", async () => {
    db.rpc.mockResolvedValue({ data: [{ outcome: "unavailable", job_posting_id: null, title: null, new_expires_at: null }], error: null });
    expect(await redeemExtendToken(TOKEN, NOW)).toMatchObject({ outcome: "invalid" });
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
  const reminder = (over: Record<string, unknown> = {}) => ({
    job_posting_id: "j1",
    closes_at: "2026-10-05T12:00:00.000Z",
    used_at: null,
    sent_at: "2026-10-02T19:00:00Z",
    ...over,
  });
  const job = (over: Record<string, unknown> = {}) => ({
    id: "j1",
    title: "Backend Engineer",
    status: "open",
    source_type: "internal",
    expires_at: "2026-10-05T12:00:00.000Z",
    ...over,
  });

  it("is ready for an unused, unexpired link to an open employer posting, names the NEW date, and never calls redeem", async () => {
    db.reminder = reminder();
    db.job = job();
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({
      state: "ready",
      jobId: "j1",
      title: "Backend Engineer",
      closesAt: "2026-10-05T12:00:00.000Z",
      newClosesAt: new Date(new Date("2026-10-05T12:00:00.000Z").getTime() + 30 * DAY).toISOString(),
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.hashes).toEqual([hashExtendToken(TOKEN)]);
  });

  it("unknown token: invalid", async () => {
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "invalid" });
  });

  it("used: carries the posting's CURRENT closing date and title", async () => {
    db.reminder = reminder({ used_at: "2026-10-03T00:00:00Z" });
    db.job = job({ expires_at: "2026-12-02T12:00:00.000Z" });
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({
      state: "used",
      title: "Backend Engineer",
      closesAt: "2026-12-02T12:00:00.000Z",
    });
  });

  it("used, but the posting has no closing date to name: still 'used'", async () => {
    db.reminder = reminder({ used_at: "2026-10-03T00:00:00Z" });
    db.job = job({ expires_at: null });
    expect(await peekExtendToken(TOKEN, NOW)).toMatchObject({ state: "used" });
  });

  it("expired once the closing date has passed", async () => {
    db.reminder = reminder({ closes_at: "2026-10-03T11:59:59.000Z" });
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "expired" });
  });

  it.each(["closed", "removed", "draft"])("closed for a %s employer posting", async (status) => {
    db.reminder = reminder();
    db.job = job({ status });
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "closed" });
  });

  it("no_closing_date for an external posting, and for one whose date was cleared", async () => {
    db.reminder = reminder();
    db.job = job({ source_type: "external" });
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "no_closing_date" });
    db.job = job({ expires_at: null });
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "no_closing_date" });
  });

  it("a posting that no longer exists is invalid, not an error page", async () => {
    db.reminder = reminder();
    db.job = null;
    expect(await peekExtendToken(TOKEN, NOW)).toEqual({ state: "invalid" });
  });

  it("malformed token: invalid without a query", async () => {
    expect(await peekExtendToken("nope", NOW)).toEqual({ state: "invalid" });
    expect(db.hashes).toEqual([]);
  });
});
