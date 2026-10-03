/**
 * The refresh at the END of the ingest route (owner's decision, option b): ingest changes postings (new ones have no stored score, a posting
 * whose JD or seniority changed loses every user's score through trigger 0069) and the once-a-day refresh left that gap open for hours. This
 * orchestrator runs the (gap-driven) refresh right after ingest, inside a time budget, and must:
 *   - be bounded by a deadline measured from the ROUTE's start (stop on a user boundary, report complete:false, leave the rest to the
 *     16:00 safety-net refresh);
 *   - SKIP cleanly, with a logged reason and nothing written, when ingest itself has used most of the budget;
 *   - never throw: a refresh failure is a result, not an exception, so it can never cancel or fail ingestion;
 *   - log exactly ONE line (ingest duration, refresh duration, postings refreshed, rows written, complete), with no personal data.
 */
import { describe, expect, it, vi } from "vitest";
import { loadModule } from "../support/load-module";

interface RefreshSummaryLike {
  ok: boolean;
  usersRefreshed: number;
  postingsScored: number;
  distinctPostingsScored: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
  complete: boolean;
  stoppedBy: "deadline" | null;
}
interface Outcome {
  ran: boolean;
  skippedReason: string | null;
  complete: boolean;
  rowsWritten: number;
  postingsRefreshed: number;
  failed: number;
  error?: string;
  ingestMs: number;
  refreshMs: number;
}
interface Core {
  runPostIngestRefresh(args: {
    routeStartedAtMs: number;
    ingestFinishedAtMs: number;
    now: () => number;
    refresh: (opts: { shouldStop: () => boolean }) => Promise<RefreshSummaryLike>;
    log: (line: string) => void;
  }): Promise<Outcome>;
}
interface Limits {
  REFRESH_SELF_STOP_MS: number;
  REFRESH_MIN_USEFUL_MS: number;
}
const load = () => loadModule<Core>("@/lib/matching/post-ingest-refresh");
const loadLimits = () => loadModule<Limits>("@/lib/matching/post-ingest-refresh-limits");

const summary = (over: Partial<RefreshSummaryLike> = {}): RefreshSummaryLike => ({
  ok: true,
  usersRefreshed: 6,
  postingsScored: 1149,
  distinctPostingsScored: 205,
  failed: 0,
  errors: [],
  complete: true,
  stoppedBy: null,
  ...over,
});

/** A controllable clock. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), advance: (d: number) => (t += d), get: () => t };
}

describe("a normal run", () => {
  it("runs the refresh, returns what it wrote, and logs exactly one line with the five facts and no personal data", async () => {
    const { runPostIngestRefresh } = await load();
    const c = clock();
    const log = vi.fn();
    const refresh = vi.fn(async () => {
      c.advance(7_000);
      return summary({ errors: [{ userId: "11111111-2222-3333-4444-555555555555", message: "x" }], failed: 1 });
    });
    const out = await runPostIngestRefresh({ routeStartedAtMs: c.get(), ingestFinishedAtMs: c.get() + 20_000, now: c.now, refresh, log });
    c.set(c.get());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(out.ran).toBe(true);
    expect(out.rowsWritten).toBe(1149);
    expect(out.postingsRefreshed).toBe(205);
    expect(out.complete).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    for (const fact of ["ingestMs=", "refreshMs=", "postingsRefreshed=205", "rowsWritten=1149", "complete=true"]) expect(line, fact).toContain(fact);
    expect(line, "no user id in the log").not.toContain("11111111-2222-3333-4444-555555555555");
    expect(line).not.toMatch(/@/);
  });
});

describe("the deadline", () => {
  it("shouldStop is false while inside the budget and true once the route has run for REFRESH_SELF_STOP_MS", async () => {
    const { runPostIngestRefresh } = await load();
    const { REFRESH_SELF_STOP_MS } = await loadLimits();
    const c = clock();
    const seen: boolean[] = [];
    const refresh = async ({ shouldStop }: { shouldStop: () => boolean }) => {
      seen.push(shouldStop());
      c.set(c.get() + REFRESH_SELF_STOP_MS); // far past the deadline
      seen.push(shouldStop());
      return summary({ complete: false, stoppedBy: "deadline" });
    };
    const out = await runPostIngestRefresh({ routeStartedAtMs: c.get(), ingestFinishedAtMs: c.get() + 5_000, now: c.now, refresh, log: () => {} });
    expect(seen).toEqual([false, true]);
    expect(out.complete, "an unfinished run says so").toBe(false);
  });

  it("an unfinished run is logged complete=false (the rest is left to the 16:00 refresh)", async () => {
    const { runPostIngestRefresh } = await load();
    const c = clock();
    const log = vi.fn();
    await runPostIngestRefresh({
      routeStartedAtMs: c.get(),
      ingestFinishedAtMs: c.get() + 5_000,
      now: c.now,
      refresh: async () => summary({ complete: false, stoppedBy: "deadline" }),
      log,
    });
    expect(String(log.mock.calls[0][0])).toContain("complete=false");
  });
});

describe("when ingest itself used most of the budget", () => {
  it("SKIPS the refresh, writes nothing, and logs ONE line with the reason", async () => {
    const { runPostIngestRefresh } = await load();
    const { REFRESH_SELF_STOP_MS, REFRESH_MIN_USEFUL_MS } = await loadLimits();
    const c = clock();
    const log = vi.fn();
    const refresh = vi.fn();
    // ingest ended with fewer than REFRESH_MIN_USEFUL_MS left before the self-stop
    const finishedAt = c.get() + REFRESH_SELF_STOP_MS - REFRESH_MIN_USEFUL_MS + 1;
    c.set(finishedAt);
    const out = await runPostIngestRefresh({ routeStartedAtMs: 1_000_000, ingestFinishedAtMs: finishedAt, now: c.now, refresh, log });
    expect(refresh, "nothing may be started that cannot finish").not.toHaveBeenCalled();
    expect(out.ran).toBe(false);
    expect(out.skippedReason).toMatch(/ingest used/i);
    expect(out.rowsWritten).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/skipped/i);
    expect(String(log.mock.calls[0][0])).toMatch(/ingest used/i);
  });

  it("just inside the limit it still runs", async () => {
    const { runPostIngestRefresh } = await load();
    const { REFRESH_SELF_STOP_MS, REFRESH_MIN_USEFUL_MS } = await loadLimits();
    const c = clock();
    const finishedAt = c.get() + REFRESH_SELF_STOP_MS - REFRESH_MIN_USEFUL_MS - 1;
    c.set(finishedAt);
    const refresh = vi.fn(async () => summary());
    const out = await runPostIngestRefresh({ routeStartedAtMs: 1_000_000, ingestFinishedAtMs: finishedAt, now: c.now, refresh, log: () => {} });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(out.ran).toBe(true);
  });
});

describe("it never throws", () => {
  it("a refresh that throws is a result (error set, ran true), logged once, and the promise resolves", async () => {
    const { runPostIngestRefresh } = await load();
    const c = clock();
    const log = vi.fn();
    const out = await runPostIngestRefresh({
      routeStartedAtMs: c.get(),
      ingestFinishedAtMs: c.get() + 1_000,
      now: c.now,
      refresh: async () => {
        throw new Error("connection reset");
      },
      log,
    });
    expect(out.ran).toBe(true);
    expect(out.error).toMatch(/connection reset/);
    expect(out.complete).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a refresh that reports ok:false (its board query failed) is reported, not thrown, and not called complete", async () => {
    const { runPostIngestRefresh } = await load();
    const c = clock();
    const out = await runPostIngestRefresh({
      routeStartedAtMs: c.get(),
      ingestFinishedAtMs: c.get() + 1_000,
      now: c.now,
      refresh: async () => summary({ ok: false, complete: true, postingsScored: 0, distinctPostingsScored: 0 }),
      log: () => {},
    });
    expect(out.error).toBeTruthy();
    expect(out.complete).toBe(false);
  });
});
