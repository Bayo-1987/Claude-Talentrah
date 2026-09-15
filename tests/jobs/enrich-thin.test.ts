/**
 * Stage 8 Step 1b (docs/stage8-match-accuracy.md,
 * docs/ingest-llm-enrichment.md) — ingest-time LLM enrichment for postings
 * still thin after the heuristic extraction pipeline.
 *
 * Three things this file has to prove, in order of how load-bearing they
 * are:
 *
 *  1. THE FLAG IS THE FIRST THING CHECKED, AND NOTHING RUNS WHILE IT'S OFF.
 *     Same discipline as tests/digest/flag-gate.test.ts: the stronger claim
 *     is not "it enriched nothing" but "it never even queried job_postings"
 *     — a version that gathers candidates and then declines to call the
 *     provider is one refactor away from spending real budget while still
 *     "gated."
 *  2. selectEnrichmentCandidates is oldest-thin-first and respects the cap,
 *     pure and DB-free.
 *  3. mergeExtractedSkills dedupes case-insensitively and drops the bare
 *     short-token noise the ESCO false-positive pass
 *     (docs/stage8-match-accuracy.md) already measured at scale.
 *
 * The database is mocked throughout — no real Supabase project touched, and
 * no real LLM call anywhere in this file (the provider is mocked too).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const flagValue = vi.hoisted(() => ({ enabled: false }));
const tablesRead = vi.hoisted(() => [] as string[]);
const updates = vi.hoisted(() => [] as Array<{ id: string; patch: Record<string, unknown> }>);
const candidateRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const extractSkills = vi.hoisted(() => vi.fn());

vi.mock("@/lib/flags/read", () => ({
  isFeatureEnabled: vi.fn(async (key: string) => {
    expect(key).toBe("ingest_llm_enrichment");
    return flagValue.enabled;
  }),
}));

vi.mock("@/lib/llm/jd-extraction", () => ({
  getJdExtractionProvider: () => ({ name: "mock", model: "mock", extractSkills }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      tablesRead.push(table);
      let isUpdate = false;
      let patch: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (p: Record<string, unknown>) => {
          isUpdate = true;
          patch = p;
          return chain;
        },
        eq: (_col: string, val: string) => {
          if (isUpdate) {
            updates.push({ id: val, patch });
            return Promise.resolve({ error: null });
          }
          return chain;
        },
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: candidateRows, error: null });
      return chain;
    },
  }),
}));

import { enrichThinPostings, mergeExtractedSkills, selectEnrichmentCandidates } from "@/lib/jobs/enrich-thin";

beforeEach(() => {
  flagValue.enabled = false;
  tablesRead.length = 0;
  updates.length = 0;
  candidateRows.length = 0;
  extractSkills.mockReset();
});

describe("enrichThinPostings — flag off (today's shipped state)", () => {
  it("does not enrich anything", async () => {
    const summary = await enrichThinPostings();
    expect(summary).toEqual({ enabled: false, attempted: 0, enriched: 0, errors: [] });
  });

  it("does not even query job_postings", async () => {
    // The stronger claim, matching flag-gate.test.ts's own reasoning: a
    // version that fetches candidates and then declines to call the
    // provider would pass a weaker assertion while being one refactor away
    // from spending real budget.
    await enrichThinPostings();
    expect(tablesRead).toEqual([]);
    expect(extractSkills).not.toHaveBeenCalled();
  });
});

describe("enrichThinPostings — flag on", () => {
  beforeEach(() => {
    flagValue.enabled = true;
  });

  it("enriches a thin candidate and marks it attempted", async () => {
    candidateRows.push({
      id: "job-1",
      description: "Needs Stata and survey design.",
      structured_jd: { skills: ["project management"], keywords: ["project management"], responsibilities: [] },
      posted_at: "2026-09-01T00:00:00Z",
    });
    extractSkills.mockResolvedValue({ skills: ["stata", "survey design"], usage: null });

    const summary = await enrichThinPostings();

    expect(summary.enabled).toBe(true);
    expect(summary.attempted).toBe(1);
    expect(summary.enriched).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(tablesRead).toContain("job_postings");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("job-1");
    expect(updates[0]?.patch.llm_enrichment_attempted_at).toEqual(expect.any(String));
    expect((updates[0]?.patch.structured_jd as { skills: string[] }).skills).toEqual([
      "project management",
      "stata",
      "survey design",
    ]);
  });

  it("does NOT re-enrich a posting that is no longer thin (re-checked live, not cached)", async () => {
    // 3 screenable tags already — isThinScreenableTagSet's own boundary
    // (THIN_SCREENABLE_TAG_MAX = 2) means this posting no longer qualifies,
    // even though it was never previously attempted.
    candidateRows.push({
      id: "job-not-thin",
      description: "...",
      structured_jd: { skills: ["sql", "python", "aws"], keywords: [], responsibilities: [] },
      posted_at: "2026-09-01T00:00:00Z",
    });

    const summary = await enrichThinPostings();
    expect(summary.attempted).toBe(0);
    expect(extractSkills).not.toHaveBeenCalled();
  });

  it("respects the per-run cap, oldest-posted-first", async () => {
    for (let i = 0; i < 5; i++) {
      candidateRows.push({
        id: `job-${i}`,
        description: "thin JD",
        structured_jd: { skills: [], keywords: [], responsibilities: [] },
        // Deliberately out of order in the fetched batch — the selection
        // logic must sort, not trust fetch order.
        posted_at: new Date(2026, 0, 5 - i).toISOString(),
      });
    }
    extractSkills.mockResolvedValue({ skills: ["x"], usage: null });

    const summary = await enrichThinPostings(2);

    expect(summary.attempted).toBe(2);
    expect(summary.enriched).toBe(2);
    // The two OLDEST postings (highest i, earliest date) should have been
    // the ones enriched.
    expect(updates.map((u) => u.id).sort()).toEqual(["job-3", "job-4"]);
  });

  it("marks a posting attempted even when the provider call fails, so it is never retried forever", async () => {
    candidateRows.push({
      id: "job-fails",
      description: "thin JD",
      structured_jd: { skills: [], keywords: [], responsibilities: [] },
      posted_at: "2026-09-01T00:00:00Z",
    });
    extractSkills.mockRejectedValue(new Error("provider exploded"));

    const summary = await enrichThinPostings();

    expect(summary.enriched).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("job-fails");
    expect(summary.errors[0]).toContain("provider exploded");
    // Still marked attempted (the fallback update in the catch branch).
    const attemptOnlyUpdate = updates.find(
      (u) => u.id === "job-fails" && !("structured_jd" in u.patch),
    );
    expect(attemptOnlyUpdate).toBeDefined();
  });
});

describe("selectEnrichmentCandidates", () => {
  const row = (id: string, skillCount: number, postedAt: string) => ({
    id,
    description: "",
    structured_jd: { skills: Array.from({ length: skillCount }, (_, i) => `skill-${i}`), keywords: [], responsibilities: [] },
    posted_at: postedAt,
  });

  it("filters to only thin postings (screenable tag count <= 2)", () => {
    const rows = [row("thin-0", 0, "2026-01-01"), row("not-thin", 3, "2026-01-01"), row("thin-2", 2, "2026-01-01")];
    const selected = selectEnrichmentCandidates(rows, 10);
    expect(selected.map((r) => r.id).sort()).toEqual(["thin-0", "thin-2"]);
  });

  it("excludes NON_SCREENABLE_SKILLS from the count — 3 non-screenable tags is still thin", () => {
    const rows = [
      {
        id: "all-non-screenable",
        description: "",
        structured_jd: { skills: ["communication", "leadership", "operations"], keywords: [], responsibilities: [] },
        posted_at: "2026-01-01",
      },
    ];
    expect(selectEnrichmentCandidates(rows, 10).map((r) => r.id)).toEqual(["all-non-screenable"]);
  });

  it("orders oldest posted_at first", () => {
    const rows = [row("newest", 0, "2026-03-01"), row("oldest", 0, "2026-01-01"), row("middle", 0, "2026-02-01")];
    expect(selectEnrichmentCandidates(rows, 10).map((r) => r.id)).toEqual(["oldest", "middle", "newest"]);
  });

  it("caps the result even when more thin candidates exist", () => {
    const rows = [row("a", 0, "2026-01-01"), row("b", 0, "2026-01-02"), row("c", 0, "2026-01-03")];
    expect(selectEnrichmentCandidates(rows, 2)).toHaveLength(2);
  });

  it("a null posted_at sorts as if it were the oldest (epoch), never crashing", () => {
    const rows = [row("has-date", 0, "2026-01-01"), { ...row("no-date", 0, "2026-01-01"), posted_at: null }];
    expect(() => selectEnrichmentCandidates(rows, 10)).not.toThrow();
  });
});

describe("mergeExtractedSkills", () => {
  it("appends new skills after existing ones, preserving existing order", () => {
    expect(mergeExtractedSkills(["project management"], ["stata", "survey design"])).toEqual([
      "project management",
      "stata",
      "survey design",
    ]);
  });

  it("de-duplicates case-insensitively against what's already there", () => {
    expect(mergeExtractedSkills(["SQL"], ["sql", "python"])).toEqual(["SQL", "python"]);
  });

  it("de-duplicates within the extracted batch itself", () => {
    expect(mergeExtractedSkills([], ["python", "Python", "python"])).toEqual(["python"]);
  });

  it("drops bare tokens under 3 characters — the ESCO false-positive pass's own finding", () => {
    // docs/stage8-match-accuracy.md's false-positive pass found ESCO's own
    // "R" (the programming language) producing a real false positive against
    // an email signature (\bR\b matching "R.Zozo@..."). A length floor is a
    // blunt instrument but catches exactly that shape of noise cheaply.
    expect(mergeExtractedSkills([], ["r", "go", "sql"])).toEqual(["sql"]);
  });

  it("lowercases and trims whitespace", () => {
    expect(mergeExtractedSkills([], ["  Stata  ", "SURVEY DESIGN"])).toEqual(["stata", "survey design"]);
  });
});
