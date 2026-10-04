/**
 * What the owner approves before the write run is the SHAPE of the change, not just a count (S3-63 3c): for the candidate rows, how many scores go
 * up, down or stay, by how much, how many change the label the FEED shows, how many end with no tier or unscreened, rows per user (ranked, no ids)
 * and the ten largest drops (numbers only). The dry run therefore COMPUTES the new scores (read-only: it loads resumes and postings, it writes
 * nothing). Also here: the stub skill skip, a user above the batch size, and the post-run verification of a random sample.
 *
 * Expectations are computed independently in this file from the same primitives the feed uses (computeMatchScore, describeMatchConfidence), so
 * the aggregation in the job is checked against a second, simple implementation.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import { computeMatchScore } from "@/lib/matching/score";
import { describeMatchConfidence } from "@/lib/match-tier";
import type { StructuredResume } from "@/lib/resume/types";
import type { ScoredJobLike } from "@/lib/matching/compute-and-store";

interface Posting {
  id: string;
  title: string;
  structuredJd: unknown;
  seniority: null;
  open: boolean;
}
interface Row {
  userId: string;
  jobId: string;
  score: number;
  explanation: unknown;
}
interface Shape {
  rows: number;
  up: number;
  down: number;
  same: number;
  changeBuckets: Record<string, number>;
  labelChanges: Record<string, number>;
  labelUnchanged: number;
  endingNoTier: number;
  endingUnscreened: number;
  rowsPerUserRanked: number[];
  largestDrops: Array<{ from: number; to: number }>;
}
interface Summary {
  ok: boolean;
  rowsRescored: number;
  rowsToRescore: number;
  skippedStubSkill: number;
  skippedPostingGone: number;
  complete: boolean;
  nextCursor: string | null;
  stoppedBy: string | null;
  shape: Shape;
}
interface Core {
  STUB_ENRICHMENT_SKILL: string;
  rescoreStale(
    deps: {
      listStaleRows(after: string | null): Promise<Row[]>;
      loadBaseResume(userId: string): Promise<StructuredResume | null>;
      loadPostings(ids: string[]): Promise<Posting[]>;
      persist(userId: string, scored: ScoredJobLike[]): Promise<{ ok: boolean; persisted: number }>;
    },
    opts: { dryRun: boolean; batchSize?: number; maxRows?: number; cursor?: string | null },
  ): Promise<Summary>;
  verifyRescoredSample(
    deps: {
      listRescoredRows(): Promise<Array<{ userId: string; jobId: string }>>;
      loadRows(rows: Array<{ userId: string; jobId: string }>): Promise<Array<{ userId: string; jobId: string; score: number; tier: string; explanation: unknown }>>;
      loadBaseResume(userId: string): Promise<StructuredResume | null>;
      loadPostings(ids: string[]): Promise<Posting[]>;
    },
    n: number,
    random?: () => number,
  ): Promise<{ checked: number; matching: number; mismatching: number; unverifiable: number }>;
}
const load = () => loadModule<Core>("@/lib/matching/rescore-stale");

const resume = (): StructuredResume =>
  ({
    contact: {},
    experience: [{ title: "Product Manager", company: "Co", startDate: "2020", endDate: "2024", description: "" }],
    education: [],
    skills: ["sql", "python", "tableau", "excel"],
    projects: [],
    certifications: [],
  }) as unknown as StructuredResume;

const job = (id: string, skills: string[], title = "Senior Product Manager"): Posting => ({ id, title, structuredJd: { skills }, seniority: null, open: true });
const OLD_EXPLANATION = { matchedSkills: ["a", "b", "c"], missingSkills: [], seniorityAlignment: "unknown" };

function world(rows: Row[], postings: Posting[], opts: { noResume?: string[] } = {}) {
  const persisted: Array<{ userId: string; ids: string[] }> = [];
  const loaded: string[][] = [];
  return {
    persisted,
    loaded,
    deps: {
      async listStaleRows(after: string | null) {
        return rows.filter((r) => after === null || r.userId > after).sort((a, b) => (a.userId === b.userId ? a.jobId.localeCompare(b.jobId) : a.userId.localeCompare(b.userId)));
      },
      async loadBaseResume(userId: string) {
        return opts.noResume?.includes(userId) ? null : resume();
      },
      async loadPostings(ids: string[]) {
        loaded.push(ids);
        return postings.filter((p) => ids.includes(p.id));
      },
      async persist(userId: string, scored: ScoredJobLike[]) {
        persisted.push({ userId, ids: scored.map((s) => s.job.id) });
        return { ok: true, persisted: scored.length };
      },
    },
  };
}

/** The independent expectation for one row: what the feed would show before and after. */
function expectOne(row: Row, p: Posting) {
  const r = computeMatchScore(resume(), (p.structuredJd as { skills: string[] }).skills, undefined, p.title);
  const label = (score: number, explanation: unknown) => {
    const d = describeMatchConfidence(score, explanation);
    return d.tier ? d.tier : d.isUnscreened ? "unscreened" : "none";
  };
  return { oldScore: row.score, newScore: r.score, oldLabel: label(row.score, row.explanation), newLabel: label(r.score, r.explanation) };
}

describe("the dry run shows the SHAPE of the change and still writes nothing", () => {
  const postings = [job("a", ["sql", "python", "tableau"]), job("b", ["sql", "excel", "kubernetes", "go"]), job("c", ["kubernetes", "go", "rust", "java"]), job("d", [])];
  const rows: Row[] = [
    { userId: "u1", jobId: "a", score: 40, explanation: OLD_EXPLANATION },
    { userId: "u1", jobId: "b", score: 100, explanation: OLD_EXPLANATION },
    { userId: "u1", jobId: "c", score: 90, explanation: OLD_EXPLANATION },
    { userId: "u2", jobId: "d", score: 75, explanation: OLD_EXPLANATION },
  ];

  it("computes new scores read-only: it loads postings, persists NOTHING, and reports every row it considered", async () => {
    const { rescoreStale } = await load();
    const w = world(rows, postings);
    const s = await rescoreStale(w.deps, { dryRun: true });
    expect(s.ok).toBe(true);
    expect(w.persisted, "a dry run writes nothing").toEqual([]);
    expect(w.loaded.flat().length, "it loads postings to compute the shape").toBeGreaterThan(0);
    expect(s.rowsRescored).toBe(0);
    expect(s.shape.rows).toBe(4);
  });

  it("up / down / same and the size-of-change buckets equal an independent recomputation", async () => {
    const { rescoreStale } = await load();
    const s = await rescoreStale(world(rows, postings).deps, { dryRun: true });
    const exp = rows.map((r) => expectOne(r, postings.find((p) => p.id === r.jobId)!));
    expect(s.shape.up).toBe(exp.filter((e) => e.newScore > e.oldScore).length);
    expect(s.shape.down).toBe(exp.filter((e) => e.newScore < e.oldScore).length);
    expect(s.shape.same).toBe(exp.filter((e) => e.newScore === e.oldScore).length);
    const bucket = (d: number) => (d <= 5 ? "1-5" : d <= 10 ? "6-10" : d <= 20 ? "11-20" : "over20");
    const wanted: Record<string, number> = { "1-5": 0, "6-10": 0, "11-20": 0, over20: 0 };
    for (const e of exp) if (e.newScore !== e.oldScore) wanted[bucket(Math.abs(e.newScore - e.oldScore))]++;
    expect(s.shape.changeBuckets).toEqual(wanted);
  });

  it("label changes use the labels the FEED shows (tier names, 'none' under 60, 'unscreened' with no tags), counted from-to, with the unchanged count and the ending counts", async () => {
    const { rescoreStale } = await load();
    const s = await rescoreStale(world(rows, postings).deps, { dryRun: true });
    const exp = rows.map((r) => expectOne(r, postings.find((p) => p.id === r.jobId)!));
    const wanted: Record<string, number> = {};
    let unchanged = 0;
    for (const e of exp) {
      if (e.oldLabel === e.newLabel) unchanged++;
      else wanted[`${e.oldLabel} -> ${e.newLabel}`] = (wanted[`${e.oldLabel} -> ${e.newLabel}`] ?? 0) + 1;
    }
    expect(s.shape.labelChanges).toEqual(wanted);
    expect(s.shape.labelUnchanged).toBe(unchanged);
    expect(s.shape.endingNoTier).toBe(exp.filter((e) => e.newLabel === "none").length);
    expect(s.shape.endingUnscreened).toBe(exp.filter((e) => e.newLabel === "unscreened").length);
    expect(Object.keys(s.shape.labelChanges).every((k) => /^(excellent|good|fair|none|unscreened) -> (excellent|good|fair|none|unscreened)$/.test(k))).toBe(true);
  });

  it("rows per user are ranked largest first and carry no user id; the largest drops are numbers only, at most ten, biggest first", async () => {
    const { rescoreStale } = await load();
    const many: Row[] = [];
    for (let i = 0; i < 14; i++) many.push({ userId: "u9", jobId: `x${i}`, score: 100, explanation: OLD_EXPLANATION });
    many.push({ userId: "u1", jobId: "a", score: 100, explanation: OLD_EXPLANATION });
    const manyPostings = [...Array.from({ length: 14 }, (_, i) => job(`x${i}`, ["kubernetes", "go", "rust", "java"])), job("a", ["sql", "python", "tableau"])];
    const s = await rescoreStale(world(many, manyPostings).deps, { dryRun: true });
    expect(s.shape.rowsPerUserRanked).toEqual([14, 1]);
    expect(s.shape.largestDrops.length).toBeLessThanOrEqual(10);
    for (const d of s.shape.largestDrops) expect(Object.keys(d).sort()).toEqual(["from", "to"]);
    const drops = s.shape.largestDrops.map((d) => d.from - d.to);
    expect(drops).toEqual([...drops].sort((a, b) => b - a));
    expect(JSON.stringify(s.shape)).not.toMatch(/u9|u1|userId/);
  });
});

describe("the stub enrichment skill: a posting that still carries it is skipped and counted on its own", () => {
  it("is not scored, not written, and counted as skippedStubSkill (the other rows are rescored)", async () => {
    const core = await load();
    const rows: Row[] = [
      { userId: "u1", jobId: "clean", score: 90, explanation: OLD_EXPLANATION },
      { userId: "u1", jobId: "stubbed", score: 90, explanation: OLD_EXPLANATION },
    ];
    const postings = [job("clean", ["sql", "python"]), job("stubbed", ["sql", core.STUB_ENRICHMENT_SKILL])];
    const w = world(rows, postings);
    const s = await core.rescoreStale(w.deps, { dryRun: false });
    expect(s.skippedStubSkill).toBe(1);
    expect(s.rowsRescored).toBe(1);
    expect(w.persisted).toEqual([{ userId: "u1", ids: ["clean"] }]);
    expect(s.shape.rows, "the shape covers only rows that would be written").toBe(1);
  });

  it("the skipped constant IS the stub provider's fixed skill (so a rename of the stub's value fails here, not silently)", async () => {
    const core = await load();
    const { StubJdExtractionProvider } = await loadModule<{ StubJdExtractionProvider: new () => { extractSkills(): Promise<{ skills: string[] }> } }>("@/lib/llm/jd-extraction/stub-provider");
    const out = await new StubJdExtractionProvider().extractSkills();
    expect(out.skills).toEqual([core.STUB_ENRICHMENT_SKILL]);
  });
});

describe("a user whose rows exceed the batch size is processed WHOLE (never starved)", () => {
  it("one user with 7 stale rows and maxRows 3, batchSize 2: all 7 are rescored in one call, in writes of 2, 2, 2, 1; the next user waits for the cursor", async () => {
    const { rescoreStale } = await load();
    const rows: Row[] = [];
    for (let i = 0; i < 7; i++) rows.push({ userId: "u1", jobId: `j${i}`, score: 80, explanation: OLD_EXPLANATION });
    rows.push({ userId: "u2", jobId: "j0", score: 80, explanation: OLD_EXPLANATION });
    const postings = Array.from({ length: 7 }, (_, i) => job(`j${i}`, ["sql", "python"]));
    const w = world(rows, postings);
    const first = await rescoreStale(w.deps, { dryRun: false, maxRows: 3, batchSize: 2 });
    expect(first.rowsRescored, "the user is finished even though 7 exceeds maxRows 3").toBe(7);
    expect(w.persisted.map((p) => p.ids.length)).toEqual([2, 2, 2, 1]);
    expect(first.stoppedBy).toBe("maxRows");
    expect(first.nextCursor).toBe("u1");
    expect(first.complete).toBe(false);
    const second = await rescoreStale(w.deps, { dryRun: false, maxRows: 3, batchSize: 2, cursor: first.nextCursor });
    expect(second.complete).toBe(true);
  });
});

describe("verifying a random sample after the write run", () => {
  const postings = [job("a", ["sql", "python"]), job("b", ["sql", "excel"]), job("c", ["python", "tableau"])];
  const stored = (jobId: string, tamper = false) => {
    const p = postings.find((x) => x.id === jobId)!;
    const r = computeMatchScore(resume(), (p.structuredJd as { skills: string[] }).skills, undefined, p.title);
    return { userId: "u1", jobId, score: tamper ? r.score + 7 : r.score, tier: tamper ? "fair" : r.score >= 80 ? "excellent" : r.score >= 70 ? "good" : "fair", explanation: r.explanation };
  };
  const deps = (rows: ReturnType<typeof stored>[]) => ({
    async listRescoredRows() {
      return rows.map((r) => ({ userId: r.userId, jobId: r.jobId }));
    },
    async loadRows(sample: Array<{ userId: string; jobId: string }>) {
      return rows.filter((r) => sample.some((s) => s.jobId === r.jobId));
    },
    async loadBaseResume() {
      return resume();
    },
    async loadPostings(ids: string[]) {
      return postings.filter((p) => ids.includes(p.id));
    },
  });

  it("recomputes each sampled row from its inputs and counts matches and mismatches, nothing else", async () => {
    const { verifyRescoredSample } = await load();
    const ok = await verifyRescoredSample(deps([stored("a"), stored("b"), stored("c")]), 3, () => 0.5);
    expect(ok).toEqual({ checked: 3, matching: 3, mismatching: 0, unverifiable: 0 });
    const bad = await verifyRescoredSample(deps([stored("a"), stored("b", true), stored("c")]), 3, () => 0.5);
    expect(bad.mismatching).toBe(1);
    expect(bad.matching).toBe(2);
  });

  it("samples at most n rows, and never more than exist", async () => {
    const { verifyRescoredSample } = await load();
    expect((await verifyRescoredSample(deps([stored("a"), stored("b"), stored("c")]), 2, () => 0.3)).checked).toBe(2);
    expect((await verifyRescoredSample(deps([stored("a")]), 20, () => 0.3)).checked).toBe(1);
  });
});
