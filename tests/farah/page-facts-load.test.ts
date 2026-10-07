/**
 * The loaders behind the page facts: they read THIS user's records through the signed-in session client they are given (so the database's own row level security decides what is visible), validate every id they are
 * handed, list only what is current (open scholarships, open postings), cap what they read, and treat a failed read as "could not load", never as "empty" (an empty tracker and an unreadable tracker are different
 * statements, and the model must not be told the first when the second is true).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPageFacts } from "@/lib/farah/page-facts-load";
import { describeMatchConfidence } from "@/lib/match-tier";

const U = "11111111-1111-4111-8111-111111111111";
const ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = new Date("2026-10-04T12:00:00.000Z");

interface Call { table: string; select?: string; filters: Array<[string, unknown]>; order?: unknown; limit?: number }
/** A recording stand-in for the supabase-js query builder. `rows[table]` is what an awaited chain (or maybeSingle) resolves to; `errors[table]` makes it fail. */
function fake(rows: Record<string, unknown>, errors: Record<string, string> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const result = () => (errors[table] ? { data: null, error: { message: errors[table] } } : { data: rows[table] ?? [], error: null });
      const chain: Record<string, unknown> = {
        select: (s: string) => { call.select = s; return chain; },
        eq: (k: string, v: unknown) => { call.filters.push([k, v]); return chain; },
        order: (...a: unknown[]) => { call.order = a; return chain; },
        limit: (n: number) => { call.limit = n; return chain; },
        maybeSingle: async () => { const r = result(); return Array.isArray(r.data) ? { data: r.data[0] ?? null, error: r.error } : r; },
        then: (res: (v: unknown) => void) => res(result()),
      };
      return chain;
    },
  };
  return { client: client as never, calls };
}
const run = (kind: Parameters<typeof loadPageFacts>[0]["kind"], f: ReturnType<typeof fake>, ids: Record<string, string> = {}, deps: Record<string, unknown> = {}) =>
  loadPageFacts({ kind, supabase: f.client, userId: U, ids, now: NOW, ...deps } as never);
const EXPL = { matchedSkills: ["Excel"], missingSkills: ["SQL"], seniorityAlignment: "match", screenableTagTotal: 9 };

describe("jobs", () => {
  const rows = { match_scores: [{ score: 94, explanation: EXPL, job_postings: { title: "Data Analyst", company_name: "Acme", status: "open" } }, { score: 90, explanation: EXPL, job_postings: { title: "BI Lead", company_name: "Globex", status: "open" } }] };
  it("reads this user's own scores, best first, at most 5, for open postings only", async () => {
    const f = fake(rows);
    const out = await run("jobs", f);
    const top = f.calls.find((c) => c.table === "match_scores")!;
    expect(top.filters).toContainEqual(["user_id", U]);
    expect(top.filters).toContainEqual(["job_postings.status", "open"]);
    expect(top.limit).toBe(5);
    expect(out.facts).toContain(`Match 1: ${describeMatchConfidence(94, EXPL).displayScore}%`);
    expect(out.data).toContain("Data Analyst");
  });
  it("the job being looked at: its own score row for THIS user and that job", async () => {
    const f = fake({ match_scores: [{ score: 83, explanation: EXPL }] });
    const out = await run("jobs", f, { jobId: ID });
    const one = f.calls.find((c) => c.filters.some(([k, v]) => k === "job_posting_id" && v === ID))!;
    expect(one.filters).toContainEqual(["user_id", U]);
    expect(out.facts).toContain(`This job: ${describeMatchConfidence(83, EXPL).displayScore}%`);
  });
  it("an id that is not a uuid is never queried", async () => {
    const f = fake({});
    await run("jobs", f, { jobId: "1; drop table match_scores" });
    expect(f.calls.some((c) => c.filters.some(([k]) => k === "job_posting_id"))).toBe(false);
  });
  it("a failed read is 'could not load', never 'no top matches yet'", async () => {
    const out = await run("jobs", fake({}, { match_scores: "boom" }));
    expect(out.facts).toContain("could not be loaded");
    expect(out.facts).not.toContain("no top matches yet");
    expect(out.data).toBeUndefined();
  });
});

describe("scholarships", () => {
  const sch = (name: string, deadline: string | null, extra: Record<string, unknown> = {}) => ({ id: "s", program_name: name, provider: "P", application_deadline: deadline, close_tz: null, close_time: null, ...extra });
  it("lists only OPEN scholarships, soonest closing first, at most 8; a closed one never appears", async () => {
    const rows = [sch("Closed One", "2026-09-01"), sch("Later", "2026-12-01"), sch("Soonest", "2026-10-20"), sch("No deadline", null), ...Array.from({ length: 12 }, (_, i) => sch(`Extra ${i}`, `2027-0${(i % 9) + 1}-15`))];
    const out = await run("scholarships", fake({ scholarships: rows }));
    expect(out.data).not.toContain("Closed One");
    expect(out.data!.indexOf("Soonest")).toBeLessThan(out.data!.indexOf("Later"));
    expect(out.data!.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(8);
  });
  it("a scholarship the user is looking at: loaded by id through the same client, its terms are data, and a closed one is flagged closed", async () => {
    const row = { id: ID, program_name: "Chevening", provider: "UK", host_institution: null, degree_levels: ["masters"], field_tags: [], funding_type: "full", funding_covers: [], eligibility_nationalities: [], eligibility_prior_degree: null, eligibility_age: null, eligibility_other: null, application_deadline: "2026-09-01", close_tz: null, close_time: null };
    const f = fake({ scholarships: [row] });
    const out = await run("scholarships", f, { scholarshipId: ID });
    expect(f.calls.some((c) => c.filters.some(([k, v]) => k === "id" && v === ID))).toBe(true);
    expect(out.facts).toContain("This scholarship is closed");
    expect(out.data).toContain("Programme: Chevening");
  });
  it("a scholarship id that does not exist (or is not visible) adds nothing and says nothing about it", async () => {
    const out = await run("scholarships", fake({ scholarships: [] }), { scholarshipId: ID });
    expect(out.facts).not.toContain("This scholarship is");
  });
  it("a failed read is 'could not load', never 'no open scholarships'", async () => {
    const out = await run("scholarships", fake({}, { scholarships: "boom" }));
    expect(out.facts).toContain("could not be loaded");
    expect(out.facts).not.toContain("no open scholarships");
  });
});

describe("tracker", () => {
  const row = (title: string, company: string, daysAgo: number, stage = "applied") => ({ stage, updated_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), job_postings: { title, company_name: company }, manual_job_snapshot: null });
  it("reads only this user's applications, newest change first, at most 15, with the days since each last changed", async () => {
    const f = fake({ applications: [row("Data Analyst", "Acme", 9), row("BI Lead", "Globex", 2, "interviewing")] });
    const out = await run("tracker", f);
    const c = f.calls.find((x) => x.table === "applications")!;
    expect(c.filters).toContainEqual(["user_id", U]);
    expect(c.limit).toBe(15);
    expect(out.data).toContain("Data Analyst at Acme: stage applied, last changed 9 days ago");
    expect(out.facts).toContain("The tracker holds 2 applications");
  });
  it("an entry added by hand (no posting) uses its own snapshot", async () => {
    const out = await run("tracker", fake({ applications: [{ stage: "saved", updated_at: NOW.toISOString(), job_postings: null, manual_job_snapshot: { title: "Ops Manager", companyName: "Initech" } }] }));
    expect(out.data).toContain("Ops Manager at Initech");
  });
  it("the application being worded about is loaded by id AND this user; if it is not theirs it is not there", async () => {
    const f = fake({ applications: [] });
    const out = await run("tracker", f, { applicationId: ID });
    const one = f.calls.filter((c) => c.table === "applications").find((c) => c.filters.some(([k, v]) => k === "id" && v === ID))!;
    expect(one.filters).toContainEqual(["user_id", U]);
    expect(out.data ?? "").not.toContain("The application in question");
  });
  it("a failed read is 'could not load', never 'the tracker is empty'", async () => {
    const out = await run("tracker", fake({}, { applications: "boom" }));
    expect(out.facts).toContain("could not be loaded");
    expect(out.facts).not.toContain("The tracker is empty");
  });
});

describe("auto-apply", () => {
  it("uses the quota function the page itself uses, with this user's id", async () => {
    const seen: string[] = [];
    const out = await run("auto-apply", fake({}), {}, { getQuotaState: async (id: string) => { seen.push(id); return { submittedLast24h: 1, submittedLast7d: 2, dailyRemaining: 4, freeRemaining: 3, nextSubmissionCostsCredits: false, nextSubmissionCovered: false }; } });
    expect(seen).toEqual([U]);
    expect(out.facts).toContain("Free runs left: 3");
  });
  it("the quota is read for the SESSION user even when the click carries other ids (a job, a scholarship, an application id is never an account)", async () => {
    const seen: string[] = [];
    const other = "11111111-1111-4111-8111-111111111111";
    await run("auto-apply", fake({}), { jobId: other, scholarshipId: other, applicationId: other }, { getQuotaState: async (id: string) => { seen.push(id); return { submittedLast24h: 0, submittedLast7d: 0, dailyRemaining: 5, freeRemaining: 5, nextSubmissionCostsCredits: false, nextSubmissionCovered: false } as never; } });
    expect(seen).toEqual([U]);
  });
  it("a failed count is 'could not load', never a number", async () => {
    const out = await run("auto-apply", fake({}), {}, { getQuotaState: async () => { throw new Error("db down"); } });
    expect(out.facts).toContain("could not be loaded");
    expect(out.facts).not.toContain("Free runs left");
  });
});

describe("pages with nothing to load read nothing", () => {
  it.each(["tailor", "mentorship", "talent-directory", "refer"] as const)("%s", async (kind) => {
    const f = fake({});
    const out = await run(kind, f);
    expect(f.calls).toEqual([]);
    expect(out.facts.length).toBeGreaterThan(15);
  });
  it("resume builder reads the user's top roles only, as data", async () => {
    const f = fake({ match_scores: [{ score: 90, explanation: EXPL, job_postings: { title: "Data Analyst", company_name: "Acme", status: "open" } }] });
    const out = await run("resume-builder", f);
    expect(f.calls.every((c) => c.table === "match_scores")).toBe(true);
    expect(out.data).toContain("Data Analyst");
  });
});

describe("the loaders never use the service role", () => {
  it("page-facts-load.ts does not import it (the one function that does, getQuotaState, is the Auto-Apply page's own and is injected)", () => {
    const src = readFileSync("src/lib/farah/page-facts-load.ts", "utf8");
    expect(src).not.toMatch(/service-role|createServiceRoleClient/);
  });
});
