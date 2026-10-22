/**
 * NEXT-SEC-1: the resolved `next` and `sharp` must carry the 14 October 2026 security fixes.
 *
 * WHY. The Dependency audit job went red on `next` 16.3.8 for two advisories that Next.js' own notice
 * (https://nextjs.org/blog/nextjs-security-update-october-14-2026) fixes in 16.4.1:
 *   - GHSA-2464-fhr4-w9xw: Image Optimization API (SVG), remote code execution on glibc Linux. Workaround: `sharp` 0.35.5 or later.
 *   - GHSA-p3m5-59mp-jv5r: App Router Server Actions, denial of service (this app has Server Actions).
 * The notice also lists GHSA-673q-mjm6-r5xr (`use cache` returning typed arrays), also fixed in 16.4.1.
 *
 * WHAT THIS PINS, in the files npm actually installs from (package.json and package-lock.json, read as text; no network):
 *   - package.json pins `next` EXACTLY (no range, no tag), as the repo does today, so a routine bump group cannot move it quietly;
 *   - the lockfile's root entry, the resolved `next` and package.json all agree, and the resolved version is 16.4.1 or later;
 *   - every resolved copy of `sharp` is 0.35.5 or later, and no copy is nested under `next` (Next loads a nested copy before a hoisted one,
 *     so a stale nested `sharp` would bypass the hoisted fixed one);
 *   - every platform build of `sharp` (`@img/sharp-<platform>`) is 0.35.5 or later;
 *   - `@next/env` and every `@next/swc-*` binary are the same version as `next` (a half-moved install would leave an old native binary).
 *
 * It does not say the advisories stay fixed forever: a later advisory raises these floors by editing the two constants below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIN_NEXT = "16.4.1";
const MIN_SHARP = "0.35.5";

type LockPackage = { version?: string; dependencies?: Record<string, string> };
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, LockPackage> };
const packages = lock.packages;

/** [major, minor, patch] of a plain release, or null for anything else (a range, a tag, a prerelease). */
function release(version: string | undefined): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function atLeast(version: string | undefined, min: string): boolean {
  const v = release(version);
  const floor = release(min)!;
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== floor[i]) return v[i] > floor[i];
  }
  return true;
}

const entries = (suffix: string) => Object.entries(packages).filter(([key]) => key.endsWith(suffix));

describe(`next is ${MIN_NEXT} or later and pinned exactly`, () => {
  it("package.json pins next to one exact release (no ^, ~, range or tag)", () => {
    const declared = pkg.dependencies?.next;
    expect(declared, "package.json must list next under dependencies").toBeDefined();
    expect(declared, `next must be an exact release such as ${MIN_NEXT}, not a range`).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the lockfile's root entry matches package.json, so an install cannot choose another version", () => {
    expect(packages[""].dependencies?.next).toBe(pkg.dependencies?.next);
  });

  it(`the resolved next equals the pin and is ${MIN_NEXT} or later (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r, GHSA-673q-mjm6-r5xr)`, () => {
    const resolved = packages["node_modules/next"]?.version;
    expect(resolved).toBe(pkg.dependencies?.next);
    expect(atLeast(resolved, MIN_NEXT), `next ${resolved} is older than ${MIN_NEXT}`).toBe(true);
  });

  it("@next/env and every @next/swc-* native binary are the same version as next", () => {
    const next = packages["node_modules/next"]?.version;
    const parts = Object.entries(packages).filter(([key]) => /node_modules\/@next\/(env|swc-)/.test(key));
    expect(parts.length, "the lockfile should hold @next/env and the native binaries").toBeGreaterThanOrEqual(3);
    for (const [key, entry] of parts) expect(entry.version, key).toBe(next);
  });
});

describe(`sharp is ${MIN_SHARP} or later wherever Next could load it (GHSA-2464-fhr4-w9xw workaround)`, () => {
  it("every resolved copy of sharp is new enough, and there is at least one", () => {
    const copies = entries("node_modules/sharp");
    expect(copies.length, "the lockfile should resolve sharp").toBeGreaterThan(0);
    for (const [key, entry] of copies) expect(atLeast(entry.version, MIN_SHARP), `${key} is ${entry.version}, older than ${MIN_SHARP}`).toBe(true);
  });

  it("no copy of sharp is nested under next (Next would load it ahead of the hoisted, fixed one)", () => {
    expect(Object.keys(packages).filter((key) => /node_modules\/next\/node_modules\/sharp(\/|$)/.test(key))).toEqual([]);
  });

  it("every platform build of sharp (@img/sharp-<platform>) is new enough", () => {
    const builds = Object.entries(packages).filter(([key]) => /node_modules\/@img\/sharp-(?!libvips)[a-z0-9-]+$/.test(key));
    expect(builds.length, "the lockfile should hold at least one platform build of sharp").toBeGreaterThan(0);
    for (const [key, entry] of builds) expect(atLeast(entry.version, MIN_SHARP), `${key} is ${entry.version}, older than ${MIN_SHARP}`).toBe(true);
  });
});
