/**
 * The rescore route stops itself before the platform stops it. This pins the relationship, so nobody raises the self-stop (or lowers
 * maxDuration) past what the platform allows: a function killed at maxDuration mid-write is exactly what the self-stop exists to avoid.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESCORE_MIN_HEADROOM_MS, RESCORE_PLATFORM_CEILING_SECONDS, RESCORE_SELF_STOP_MS } from "@/lib/matching/rescore-stale-limits";

const route = readFileSync("src/app/api/admin/rescore-stale-match-scores/route.ts", "utf8");
const declared = Number(route.match(/^export const maxDuration = (\d+);/m)?.[1]);

describe("rescore route run-time limits", () => {
  it("declares maxDuration explicitly, as a literal Next can read", () => {
    expect(Number.isInteger(declared), "route must declare `export const maxDuration = <number>;`").toBe(true);
  });

  it("maxDuration is within the lowest plan's ceiling (Hobby), so it is valid on every plan", () => {
    expect(declared).toBeLessThanOrEqual(RESCORE_PLATFORM_CEILING_SECONDS);
  });

  it("the self-stop leaves real headroom under maxDuration for the write in flight and the response", () => {
    expect(RESCORE_SELF_STOP_MS).toBeLessThanOrEqual(declared * 1000 - RESCORE_MIN_HEADROOM_MS);
  });

  it("the route uses the shared self-stop, not a number of its own", () => {
    expect(route).toContain("RESCORE_SELF_STOP_MS");
    expect(route).not.toMatch(/>\s*\d[\d_]*\s*\)/);
  });
});
