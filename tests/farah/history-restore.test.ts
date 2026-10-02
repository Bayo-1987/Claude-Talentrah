/**
 * send-504 / S7 — Farah's thread comes back on reload when it is recent.
 *
 * The owner paid for two answers, reloaded, and found only "Continue where you left off with Farah?": the thread was fetched and
 * held back behind that line (so a stale fragment never greets someone on an unrelated page). That hiding was right for an OLD
 * thread and wrong for the thread you were in a moment ago. Owner's rule: if the last message is under 24 hours old, restore the
 * thread automatically on load; an older one stays behind "Continue". Nothing is deleted either way, and no retention period is
 * promised anywhere.
 *
 * Pure decision, so both sides of the line are pinned to the second.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Msg {
  id: string;
  role: "user" | "farah";
  content: string;
  created_at: string;
}
interface Mod {
  AUTO_RESTORE_WINDOW_HOURS?: number;
  shouldAutoRestoreHistory?: (messages: ReadonlyArray<Pick<Msg, "created_at">>, now: Date) => boolean;
}
const mod = () => loadModule<Mod>("@/lib/farah/history-restore");
const fn = async () => {
  const m = await mod();
  expect(m.shouldAutoRestoreHistory, "shouldAutoRestoreHistory must be exported from src/lib/farah/history-restore.ts").toBeTypeOf("function");
  return m.shouldAutoRestoreHistory!;
};

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const S = 1_000;
const msg = (createdAt: string): Msg => ({ id: createdAt, role: "farah", content: "x", created_at: createdAt });

describe("the 24-hour line", () => {
  it("is 24 hours", async () => {
    expect((await mod()).AUTO_RESTORE_WINDOW_HOURS).toBe(24);
  });

  it("a last message 23:59:59 old is restored automatically", async () => {
    expect((await fn())([msg(ago(24 * H - 1 * S))], NOW)).toBe(true);
  });

  it("a last message 24:00:01 old stays behind Continue", async () => {
    expect((await fn())([msg(ago(24 * H + 1 * S))], NOW)).toBe(false);
  });

  it("exactly 24:00:00 old is NOT 'under 24 hours': it stays behind Continue", async () => {
    expect((await fn())([msg(ago(24 * H))], NOW)).toBe(false);
  });

  it("a message from a minute ago, and from this very instant, restore", async () => {
    const f = await fn();
    expect(f([msg(ago(60 * S))], NOW)).toBe(true);
    expect(f([msg(NOW.toISOString())], NOW)).toBe(true);
  });
});

describe("it looks at the LAST message, not the first", () => {
  it("an old start with a recent end restores (the thread is live)", async () => {
    expect((await fn())([msg(ago(5 * 24 * H)), msg(ago(3 * 24 * H)), msg(ago(2 * H))], NOW)).toBe(true);
  });

  it("a recent start cannot exist without a recent end, but an all-old thread stays hidden", async () => {
    expect((await fn())([msg(ago(30 * H)), msg(ago(26 * H))], NOW)).toBe(false);
  });

  it("does not depend on the order the rows arrive in", async () => {
    const f = await fn();
    expect(f([msg(ago(2 * H)), msg(ago(5 * 24 * H))], NOW)).toBe(true);
    expect(f([msg(ago(5 * 24 * H)), msg(ago(2 * H))], NOW)).toBe(true);
  });
});

describe("degenerate input never restores by accident", () => {
  it("no messages: nothing to restore", async () => {
    expect((await fn())([], NOW)).toBe(false);
  });

  it("an unparseable timestamp is treated as old, not as 'now'", async () => {
    expect((await fn())([msg("not a date")], NOW)).toBe(false);
  });

  it("a timestamp in the future (clock skew) is not treated as recent forever", async () => {
    // Skew of a few minutes must still restore (the thread is plainly live); a date days ahead is bad data, not a live thread.
    const f = await fn();
    expect(f([msg(new Date(NOW.getTime() + 5 * 60_000).toISOString())], NOW)).toBe(true);
    expect(f([msg(new Date(NOW.getTime() + 3 * 24 * H).toISOString())], NOW)).toBe(false);
  });
});
