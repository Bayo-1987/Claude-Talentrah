/**
 * The ingest route now also runs the match-score refresh, so it must stop itself before the platform stops it. Pins the relationship so nobody
 * raises the self-stop past the platform limit (the same pattern as tests/matching/rescore-stale-limits.test.ts). 300 s is Vercel's Hobby
 * maximum and default; Pro allows more. The route declares the LOWER so it is valid on either plan.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Limits {
  REFRESH_SELF_STOP_MS: number;
  REFRESH_MIN_USEFUL_MS: number;
  REFRESH_MIN_HEADROOM_MS: number;
  PLATFORM_CEILING_SECONDS: number;
}
const route = readFileSync("src/app/api/admin/ingest-jobs/route.ts", "utf8");
const declared = Number(route.match(/^export const maxDuration = (\d+);/m)?.[1]);

describe("ingest route run-time limits", () => {
  it("declares maxDuration explicitly, as a literal Next can read, within the lowest plan's ceiling", async () => {
    const { PLATFORM_CEILING_SECONDS } = await loadModule<Limits>("@/lib/matching/post-ingest-refresh-limits");
    expect(Number.isInteger(declared), "route must declare `export const maxDuration = <number>;`").toBe(true);
    expect(declared).toBeLessThanOrEqual(PLATFORM_CEILING_SECONDS);
  });

  it("the refresh's self-stop leaves real headroom under maxDuration for the write in flight and the response", async () => {
    const { REFRESH_SELF_STOP_MS, REFRESH_MIN_HEADROOM_MS } = await loadModule<Limits>("@/lib/matching/post-ingest-refresh-limits");
    expect(REFRESH_SELF_STOP_MS).toBeLessThanOrEqual(declared * 1000 - REFRESH_MIN_HEADROOM_MS);
  });

  it("a refresh must have a useful amount of time to start at all, and that is less than the whole budget", async () => {
    const { REFRESH_SELF_STOP_MS, REFRESH_MIN_USEFUL_MS } = await loadModule<Limits>("@/lib/matching/post-ingest-refresh-limits");
    expect(REFRESH_MIN_USEFUL_MS).toBeGreaterThanOrEqual(10_000);
    expect(REFRESH_MIN_USEFUL_MS).toBeLessThan(REFRESH_SELF_STOP_MS);
  });

  it("the route uses the shared limits and the orchestrator, not numbers of its own", () => {
    expect(route).toContain("runPostIngestRefresh");
    expect(route).not.toMatch(/\b2[0-9]{2}_?000\b/);
  });
});
