/**
 * The tailoring cache version went 1 -> 2 with the bullets/normalisation change
 * (cache.ts TAILORING_CACHE_VERSION). That must only decide whether a NEW
 * generation can reuse a cache row, never whether something a user already has
 * can still be opened:
 *
 *  - A user reopens their tailored resume from the `resumes` table
 *    (`source = 'tailored'`), which the cache never touches. Old-format ones
 *    render as stored (old-format-resume-render.test.tsx).
 *  - `tailoring_result_cache` is read by exactly one function,
 *    `getCachedTailoringResult`, called from exactly one place,
 *    `tailorResumeToJob`. No page or route lists or reopens cache rows, so an
 *    orphaned v1 row is simply never looked up again (and ages out by TTL).
 *  - And if an old-shaped result IS served from the cache (a row stored under a
 *    key that is still looked up), it is returned as it was stored: no
 *    normalisation, no throw.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => {
    throw new Error("a cache hit must not reach the model");
  },
  generateWithFailover: () => {
    throw new Error("a cache hit must not reach the model");
  },
}));

const cached = vi.fn();
vi.mock("@/lib/tailoring/cache", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/tailoring/cache")>();
  return { ...actual, getCachedTailoringResult: (...a: unknown[]) => cached(...a), saveTailoringResult: async () => {} };
});

const { computeTailoringCacheKey } = await import("@/lib/tailoring/cache");
const { tailorResumeToJob } = await import("@/lib/tailoring/tailor");
const { EMPTY_RESUME } = await import("@/lib/resume/types");

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("the cache key carries the version, so a bump only affects NEW generations", () => {
  const resume = { ...EMPTY_RESUME, contact: { name: "Ada Obi" } };
  const jd = "Looking for a product manager with onboarding experience.";

  it("the key is the v2 formula, and is not the v1 key an old row was stored under", () => {
    const { cacheKey, jdTextHash, resumeContentHash } = computeTailoringCacheKey(resume, jd, false);
    const keyFor = (v: number) => sha(`v${v}:${jdTextHash}:${resumeContentHash}:cl0`);
    expect(cacheKey).toBe(keyFor(2));
    expect(cacheKey).not.toBe(keyFor(1));
  });
});

describe("only tailorResumeToJob reads the cache", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }
  const files = sourceFiles(path.join(process.cwd(), "src"));
  const readers = (needle: string) =>
    files.filter((f) => readFileSync(f, "utf8").includes(needle)).map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));

  it("the cache table is touched only inside cache.ts (and its generated types)", () => {
    expect(readers(`from("tailoring_result_cache")`)).toEqual(["src/lib/tailoring/cache.ts"]);
  });

  it("getCachedTailoringResult has no caller outside tailor.ts", () => {
    expect(readers("getCachedTailoringResult")).toEqual(["src/lib/tailoring/cache.ts", "src/lib/tailoring/tailor.ts"]);
  });
});

describe("an old-shaped result that is served from the cache comes back as stored", () => {
  it("returned untouched: paragraphs, old dates and old skill casing included, with jdTruncation recomputed", async () => {
    const oldResult = {
      structuredJd: { skills: [], keywords: [], responsibilities: [] },
      gapAnalysis: [],
      tailoredResume: {
        ...EMPTY_RESUME,
        contact: { name: "Ada Obi" },
        experience: [
          {
            title: "PM",
            company: "Acme",
            startDate: "September 2022",
            endDate: "present",
            description: "Led onboarding. • Cut drop-off by 12%. • Mentored two PMs.",
          },
        ],
        skills: ["project management", "Project-Management"],
      },
      coverLetter: null,
      atsScore: 80,
      atsFixes: [],
      proposedAdditions: [],
      jdTruncation: { originalChars: 1, usedChars: 1 },
    };
    cached.mockResolvedValue(oldResult);

    const out = await tailorResumeToJob({ ...EMPTY_RESUME, contact: { name: "Ada Obi" } }, "A short job description.", false);

    expect(out.tailoredResume).toEqual(oldResult.tailoredResume);
    expect(out.tailoredResume.experience[0].bullets).toBeUndefined();
    expect(out.tailoredResume.experience[0].startDate).toBe("September 2022");
    // jdTruncation describes THIS call's paste, never the cached blob's.
    expect(out.jdTruncation).toBeNull();
  });
});
