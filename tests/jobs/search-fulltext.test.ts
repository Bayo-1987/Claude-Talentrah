/**
 * search_job_postings (migration 0100) — Stage 8 step 2's real, ranked,
 * server-side full-text search, replacing the in-memory `searchJobs()` pass
 * for actual feed results (search.ts itself is untouched and still backs
 * search-suggestions.ts's typeahead counts — see that file's own tests).
 *
 * Every case here is one this exact design was checked against LIVE, via
 * read-only SQL against production, before this file was written — this
 * suite pins those same findings against a real migrated database so they
 * stay true, rather than re-trusting the one-off measurement forever:
 *
 *   - title beats a same-term-buried-in-a-long-description hit, never a tie
 *     (measured live: title-hit rank exactly 10x a buried hit, the A/D
 *     weight ratio, zero overlap)
 *   - structured_jd.skills terms (excel/sql/python/kubernetes) still surface
 *     correctly — and RANKED ABOVE incidental body-text noise. "excel"
 *     specifically is a real, sharp edge: Postgres's English stemmer folds
 *     "excel"/"excels"/"excelling"/"excellent"/"excellence" into ONE lexeme
 *     ('excel), so a naive full-text index over raw description prose would
 *     drown the ~54 real Excel-skill postings in ~150 "you will excel in
 *     this role" / "looking for excellent candidates" false positives.
 *     Measured live against production: with title/skills/company/
 *     description weighted A/B/C/D, all 54 skill-tagged postings ranked
 *     #1-54 and the first false positive landed at #55 — clean separation,
 *     not just "mostly fine".
 *   - a query containing a comma, parenthesis, trailing period, or literal
 *     SQL-comment syntax doesn't error and doesn't change the filter's
 *     grammar (websearch_to_tsquery treats all of it as inert punctuation —
 *     confirmed live: `excel); drop table job_postings; --` parses to
 *     `'excel' & 'drop' & 'tabl' & 'job' <-> 'post'`, plain lexemes, no
 *     escape from the tsquery grammar).
 *   - the existing composable filters (work type, seniority, source type,
 *     saved-ids) still narrow the ranked result set, the same "null means no
 *     filter, empty array matches nothing" contract every other filter on
 *     this feed uses (postingsQuery, promoted_jobs).
 *   - status='open' and the posted_at floor still apply — a search can't
 *     surface a closed/removed or stale posting the plain feed wouldn't.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";

const RUN = randomUUID().slice(0, 8);
const COMPANY = `FTS Test Co ${RUN}`;
const SINCE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

type Fixture = {
  key: string;
  title: string;
  description: string;
  skills?: string[];
  status?: "open" | "closed" | "removed";
  source_type?: "internal" | "external";
  work_type?: "remote" | "hybrid" | "onsite";
  seniority?: "entry" | "mid" | "senior" | "lead" | "executive";
  posted_at?: string;
};

const LONG_FILLER =
  "We are looking for a talented person to join our growing team. Responsibilities include working across the stack, collaborating with product, and shipping reliable, well-tested work. Benefits include health insurance and flexible hours. About the company: we build tools for small businesses across the region and have grown steadily since our founding. ".repeat(
    3,
  );

const FIXTURES: Fixture[] = [
  {
    key: "title-hit",
    title: "Kubernetes Platform Engineer",
    description: LONG_FILLER,
  },
  {
    key: "buried-hit",
    title: "Backend Engineer",
    description: `${LONG_FILLER} Somewhere deep in this long description we mention Kubernetes as one of dozens of tools our platform touches, among many others including Docker, Terraform and AWS. ${LONG_FILLER}`,
  },
  {
    key: "excel-skill",
    title: "Financial Analyst",
    description: `${LONG_FILLER} Must be proficient in Excel for financial modelling.`,
    skills: ["excel", "financial modelling"],
  },
  {
    key: "excel-verb-noise",
    title: "Customer Success Associate",
    description: `${LONG_FILLER} You will excel in this role if you bring excellent communication skills and a track record of excellence.`,
  },
  {
    key: "wrong-work-type",
    title: "Kubernetes Onsite Role",
    description: LONG_FILLER,
    work_type: "onsite",
  },
  {
    key: "wrong-seniority",
    title: "Kubernetes Executive Role",
    description: LONG_FILLER,
    seniority: "executive",
  },
  {
    key: "closed",
    title: "Kubernetes Closed Role",
    description: LONG_FILLER,
    status: "closed",
  },
  {
    key: "stale",
    title: "Kubernetes Stale Role",
    description: LONG_FILLER,
    posted_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const ids: Record<string, string> = {};

async function seed() {
  for (const f of FIXTURES) {
    const { data, error } = await admin
      .from("job_postings")
      .insert({
        source_type: f.source_type ?? "external",
        company_name: COMPANY,
        title: f.title,
        description: f.description,
        structured_jd: f.skills ? { skills: f.skills } : {},
        status: f.status ?? "open",
        posted_at: f.posted_at ?? new Date().toISOString(),
        dedup_fingerprint: `fts-${RUN}-${f.key}`,
        external_source: "fts-test",
        external_url: `https://example.test/${RUN}/${f.key}`,
        work_type: f.work_type ?? "remote",
        seniority: f.seniority ?? "mid",
      })
      .select("id")
      .single();
    if (error) throw new Error(`fixture ${f.key}: ${error.message}`);
    ids[f.key] = data.id;
  }
}

beforeAll(seed);

afterAll(async () => {
  const { error } = await admin.from("job_postings").delete().eq("company_name", COMPANY);
  if (error) throw new Error(`cleanup failed, fixtures left behind: ${error.message}`);
});

async function search(query: string, opts: Partial<Parameters<typeof admin.rpc>[1]> = {}) {
  const { data, error } = await admin.rpc("search_job_postings", {
    p_query: query,
    p_since: SINCE,
    p_source_type: null,
    p_work_types: null,
    p_seniorities: null,
    p_ids: null,
    ...opts,
  } as never);
  if (error) throw new Error(`search_job_postings(${query}): ${error.message}`);
  return (data ?? []) as { id: string; rank: number }[];
}

describe("ranking is deterministic, not a tie", () => {
  it("ranks a title hit strictly above the same term buried in a long description", async () => {
    const results = await search("kubernetes");
    const byId = new Map(results.map((r) => [r.id, r.rank]));
    const titleRank = byId.get(ids["title-hit"]);
    const buriedRank = byId.get(ids["buried-hit"]);
    expect(titleRank).toBeDefined();
    expect(buriedRank).toBeDefined();
    expect(titleRank!).toBeGreaterThan(buriedRank!);

    const order = results.map((r) => r.id);
    expect(order.indexOf(ids["title-hit"])).toBeLessThan(order.indexOf(ids["buried-hit"]));
  });
});

describe("structured_jd.skills coverage survives the move to full-text search", () => {
  it("returns the skill-tagged posting and ranks it above generic body-text noise", async () => {
    const results = await search("excel");
    const order = results.map((r) => r.id);

    expect(order).toContain(ids["excel-skill"]);
    // The stemming collision this fixture exists to catch: Postgres folds
    // "excel"/"excelling"/"excellent"/"excellence" into one lexeme, so the
    // noise fixture DOES match too — the requirement is that it never
    // outranks the real skill hit, not that it's excluded.
    expect(order).toContain(ids["excel-verb-noise"]);
    expect(order.indexOf(ids["excel-skill"])).toBeLessThan(order.indexOf(ids["excel-verb-noise"]));
  });
});

describe("sabotage-proof: punctuation and injection-shaped input", () => {
  it.each([
    ["a comma and parentheses", "kubernetes, (docker)"],
    ["a trailing period", "kubernetes."],
    ["SQL-comment-shaped input", "kubernetes); drop table job_postings; --"],
  ])("does not error or misbehave on %s", async (_label, query) => {
    const results = await search(query);
    // Still finds the real match — punctuation didn't strip the real term
    // out of the query, and the injection payload didn't do anything beyond
    // being tokenized as ordinary (non-matching) words.
    expect(results.map((r) => r.id)).toContain(ids["title-hit"]);
  });

  it("an empty query matches nothing rather than erroring", async () => {
    const results = await search("");
    expect(results).toEqual([]);
  });
});

describe("existing filters still compose with search", () => {
  it("excludes a posting outside the requested work type", async () => {
    const results = await search("kubernetes", { p_work_types: ["remote"] as never });
    const order = results.map((r) => r.id);
    expect(order).toContain(ids["title-hit"]);
    expect(order).not.toContain(ids["wrong-work-type"]);
  });

  it("excludes a posting outside the requested seniority", async () => {
    const results = await search("kubernetes", { p_seniorities: ["mid"] as never });
    const order = results.map((r) => r.id);
    expect(order).toContain(ids["title-hit"]);
    expect(order).not.toContain(ids["wrong-seniority"]);
  });

  it("an id allowlist (the Saved tab's contract) narrows to just those ids", async () => {
    const results = await search("kubernetes", { p_ids: [ids["title-hit"]] as never });
    expect(results.map((r) => r.id)).toEqual([ids["title-hit"]]);
  });

  it("an empty id array matches nothing, same as postingsQuery's saved-tab sentinel contract", async () => {
    const results = await search("kubernetes", { p_ids: [] as never });
    expect(results).toEqual([]);
  });
});

describe("status and freshness floors still apply", () => {
  it("never returns a closed posting", async () => {
    const results = await search("kubernetes");
    expect(results.map((r) => r.id)).not.toContain(ids["closed"]);
  });

  it("never returns a posting older than p_since", async () => {
    const results = await search("kubernetes");
    expect(results.map((r) => r.id)).not.toContain(ids["stale"]);
  });
});
