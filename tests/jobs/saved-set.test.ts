/**
 * send-496 / S11 — the Saved tab is ONE set: every tracker application at stage "saved", whatever happened to the
 * posting since.
 *
 * What the owner saw: 5 items in the tracker's Saved stage, none of them on the feed's Saved tab. There is no
 * separate saved-jobs table (the heart already writes the tracker row), so the set was already unified; the tab
 * was hiding rows. Measured on production: all 5 pointed at postings that had since CLOSED, and the feed's
 * discovery filters (status = open, the 30-day freshness floor, the unlisted rule) dropped them. Country dropped
 * the rest of the way: below 5 matches it "showed roles from elsewhere" next to "No saved jobs yet".
 *
 * Founder call: one saved set; no country filter on Saved; a closed role shows as closed (never Apply) and can be
 * removed; a manual tracker entry renders from its snapshot; one empty state. The pure parts of that live in
 * src/lib/jobs/saved-set.ts so they can be tested without rendering the 1,200-line feed page.
 *
 * Reached through loadModule so this compiles before the module exists.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Entry {
  applicationId: string;
  jobPostingId: string | null;
  kind: "closed" | "manual";
  title: string;
  companyName: string;
  location?: string;
  url?: string;
}
interface Mod {
  partitionSavedSet?: (
    rows: Array<{ id: string; job_posting_id: string | null; manual_job_snapshot: unknown }>,
    postings: Array<{ id: string; status: string; title: string; company_name: string; location: string | null; external_url: string | null }>,
  ) => { openPostingIds: string[]; entries: Entry[] };
  entryMatchesQuery?: (entry: Pick<Entry, "title" | "companyName" | "location">, q: string | undefined) => boolean;
  savedEmptyState?: (input: { savedTotal: number; shown: number }) => "none" | "filtered" | null;
  SAVED_TAB_MAX?: number;
  loadSavedRows?: (
    supabase: unknown,
    userId: string,
    max?: number,
  ) => Promise<{ rows: Array<{ id: string; job_posting_id: string | null; manual_job_snapshot: unknown }>; total: number; capped: boolean }>;
  savedCapNotice?: (input: { total: number; loaded: number }) => string | null;
  buildSavedPostingsQuery?: (
    supabase: unknown,
    savedIds: string[],
    columns: string,
    filters: { workTypes: string[]; seniorities: string[]; postedSince?: string },
  ) => unknown;
}

const mod = () => loadModule<Mod>("@/lib/jobs/saved-set");
const need = <T>(fn: T | undefined, name: string): T => {
  expect(fn, `${name} must be exported from src/lib/jobs/saved-set.ts`).toBeTypeOf("function");
  return fn as T;
};

const posting = (over: Partial<{ id: string; status: string; title: string; company_name: string; location: string | null; external_url: string | null }> = {}) => ({
  id: "p1",
  status: "open",
  title: "Backend Engineer",
  company_name: "Paystack",
  location: "Lagos, Nigeria",
  external_url: "https://example.test/job/1",
  ...over,
});
const row = (id: string, job_posting_id: string | null, manual_job_snapshot: unknown = null) => ({ id, job_posting_id, manual_job_snapshot });

describe("partitionSavedSet: which saved rows become cards, which become entries", () => {
  it("an open posting is left to the normal job card (its id is returned, no entry is made)", async () => {
    const { partitionSavedSet } = await mod();
    const out = need(partitionSavedSet, "partitionSavedSet")([row("a1", "p1")], [posting()]);
    expect(out.openPostingIds).toEqual(["p1"]);
    expect(out.entries).toEqual([]);
  });

  it("a CLOSED posting becomes a closed entry carrying the posting's own title, company, location and link", async () => {
    const { partitionSavedSet } = await mod();
    const out = need(partitionSavedSet, "partitionSavedSet")([row("a1", "p1")], [posting({ status: "closed" })]);
    expect(out.openPostingIds).toEqual([]);
    expect(out.entries).toEqual([
      { applicationId: "a1", jobPostingId: "p1", kind: "closed", title: "Backend Engineer", companyName: "Paystack", location: "Lagos, Nigeria", url: "https://example.test/job/1" },
    ]);
  });

  it("a posting the viewer can no longer read (removed) renders from the snapshot taken when it was saved", async () => {
    const { partitionSavedSet } = await mod();
    const snapshot = { companyName: "Moniepoint", title: "Illustrator", location: "Remote", url: "https://example.test/x" };
    const out = need(partitionSavedSet, "partitionSavedSet")([row("a1", "gone", snapshot)], []);
    expect(out.entries).toEqual([
      { applicationId: "a1", jobPostingId: "gone", kind: "closed", title: "Illustrator", companyName: "Moniepoint", location: "Remote", url: "https://example.test/x" },
    ]);
  });

  it("a manual tracker entry (no posting at all) renders from its snapshot, as a manual entry", async () => {
    const { partitionSavedSet } = await mod();
    const out = need(partitionSavedSet, "partitionSavedSet")([row("a1", null, { companyName: "Acme", title: "Designer" })], []);
    expect(out.entries).toEqual([{ applicationId: "a1", jobPostingId: null, kind: "manual", title: "Designer", companyName: "Acme" }]);
  });

  it("a saved row with NO usable snapshot still gets an entry, so it can be seen and removed (never a ghost)", async () => {
    const { partitionSavedSet } = await mod();
    const partition = need(partitionSavedSet, "partitionSavedSet");
    for (const bad of [null, undefined, "x", 5, [], { title: 5, companyName: {} }, {}]) {
      const out = partition([row("a1", "gone", bad)], []);
      expect(out.entries, JSON.stringify(bad)).toHaveLength(1);
      expect(out.entries[0].applicationId).toBe("a1");
      expect(out.entries[0].title.length).toBeGreaterThan(0);
    }
  });

  it("keeps the saved rows' own order and lists each application once", async () => {
    const { partitionSavedSet } = await mod();
    const out = need(partitionSavedSet, "partitionSavedSet")(
      [row("a1", "p1"), row("a2", "p2"), row("a3", null, { companyName: "A", title: "T" })],
      [posting({ id: "p2", status: "closed", title: "Two" }), posting({ id: "p1", status: "open" })],
    );
    expect(out.openPostingIds).toEqual(["p1"]);
    expect(out.entries.map((e) => e.applicationId)).toEqual(["a2", "a3"]);
  });
});

describe("entryMatchesQuery: the search box over snapshot-backed entries", () => {
  it("matches title, company or location, case-insensitively, as one substring (the same rule searchJobs uses)", async () => {
    const { entryMatchesQuery } = await mod();
    const m = need(entryMatchesQuery, "entryMatchesQuery");
    const e = { title: "Backend Engineer", companyName: "Paystack", location: "Lagos" };
    expect(m(e, "engineer")).toBe(true);
    expect(m(e, "PAYSTACK")).toBe(true);
    expect(m(e, "lagos")).toBe(true);
    expect(m(e, "kubernetes")).toBe(false);
  });
  it("an empty or missing query matches everything", async () => {
    const { entryMatchesQuery } = await mod();
    const m = need(entryMatchesQuery, "entryMatchesQuery");
    expect(m({ title: "T", companyName: "C" }, undefined)).toBe(true);
    expect(m({ title: "T", companyName: "C" }, "  ")).toBe(true);
  });
});

describe("savedEmptyState: ONE empty state, never two at once", () => {
  it("nothing saved at all -> 'none'", async () => {
    const { savedEmptyState } = await mod();
    expect(need(savedEmptyState, "savedEmptyState")({ savedTotal: 0, shown: 0 })).toBe("none");
  });
  it("saved items exist but the filters/search hide every one -> 'filtered' (not 'No saved jobs yet')", async () => {
    const { savedEmptyState } = await mod();
    expect(need(savedEmptyState, "savedEmptyState")({ savedTotal: 5, shown: 0 })).toBe("filtered");
  });
  it("anything shown -> no empty state", async () => {
    const { savedEmptyState } = await mod();
    expect(need(savedEmptyState, "savedEmptyState")({ savedTotal: 5, shown: 2 })).toBeNull();
  });
});

describe("buildSavedPostingsQuery: the saved ids are the user's own set, not a discovery feed", () => {
  function recorder() {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return chain;
        },
      },
    );
    const supabase = { from: (t: string) => (calls.push(["from", [t]]), chain) };
    return { supabase, calls };
  }

  it("selects by the saved ids, and applies NO status, freshness or unlisted filter", async () => {
    const { buildSavedPostingsQuery } = await mod();
    const { supabase, calls } = recorder();
    need(buildSavedPostingsQuery, "buildSavedPostingsQuery")(supabase, ["p1", "p2"], "id, title", { workTypes: [], seniorities: [] });
    expect(calls).toContainEqual(["from", ["job_postings"]]);
    expect(calls).toContainEqual(["in", ["id", ["p1", "p2"]]]);
    const names = calls.map(([n]) => n);
    // The three discovery rules that hid the owner's closed postings. RLS (status not removed/draft) stays the gate.
    expect(calls.find(([n, a]) => n === "eq" && a[0] === "status"), "status = open must not apply to the saved set").toBeUndefined();
    expect(calls.find(([n, a]) => n === "gte" && a[0] === "posted_at"), "the 30-day freshness floor must not apply").toBeUndefined();
    expect(names, "the unlisted/or rule must not apply").not.toContain("or");
  });

  it("applies the user's own 'posted within' window when they chose one, and only then", async () => {
    const { buildSavedPostingsQuery } = await mod();
    const { supabase, calls } = recorder();
    need(buildSavedPostingsQuery, "buildSavedPostingsQuery")(supabase, ["p1"], "id", { workTypes: [], seniorities: [], postedSince: "2026-09-24T00:00:00.000Z" });
    expect(calls).toContainEqual(["gte", ["posted_at", "2026-09-24T00:00:00.000Z"]]);
  });

  it("still honours the user's own work-type and seniority choices", async () => {
    const { buildSavedPostingsQuery } = await mod();
    const { supabase, calls } = recorder();
    need(buildSavedPostingsQuery, "buildSavedPostingsQuery")(supabase, ["p1"], "id", { workTypes: ["remote"], seniorities: ["senior"] });
    expect(calls).toContainEqual(["in", ["work_type", ["remote"]]]);
    expect(calls).toContainEqual(["in", ["seniority", ["senior"]]]);
  });

  it("an empty saved set matches nothing (an empty .in() would be dropped by PostgREST), not everything", async () => {
    const { buildSavedPostingsQuery } = await mod();
    const { supabase, calls } = recorder();
    need(buildSavedPostingsQuery, "buildSavedPostingsQuery")(supabase, [], "id", { workTypes: [], seniorities: [] });
    const inId = calls.find(([n, a]) => n === "in" && a[0] === "id");
    expect(inId, "an id filter must always be applied").toBeDefined();
    expect((inId![1][1] as string[]).length).toBe(1);
    expect((inId![1][1] as string[])[0]).toMatch(/^0{8}-/);
  });
});

describe("the Saved tab is bounded (a user with hundreds of saved jobs must not make the page grow without limit)", () => {
  /** A fake client over a 250-row saved set that honours order(), limit() and count: "exact", like PostgREST does. */
  function fakeApplications(total: number) {
    const all = Array.from({ length: total }, (_, i) => ({
      id: `a${String(i).padStart(3, "0")}`,
      job_posting_id: i % 5 === 0 ? null : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      manual_job_snapshot: { companyName: "Co", title: `Role ${i}` },
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const calls: Array<[string, unknown[]]> = [];
    const state = { limit: Infinity, desc: false };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) => {
              const sorted = [...all].sort((a, b) => (state.desc ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
              return resolve({ data: sorted.slice(0, state.limit), count: total, error: null });
            };
          }
          return (...args: unknown[]) => {
            calls.push([String(prop), args]);
            if (prop === "limit") state.limit = args[0] as number;
            if (prop === "order") state.desc = (args[1] as { ascending?: boolean } | undefined)?.ascending === false;
            return chain;
          };
        },
      },
    );
    return { supabase: { from: (t: string) => (calls.push(["from", [t]]), chain) }, calls };
  }

  it("has a cap that keeps the posting lookup's id list well inside a URL", async () => {
    const { SAVED_TAB_MAX } = await mod();
    expect(SAVED_TAB_MAX, "SAVED_TAB_MAX must be exported from saved-set.ts").toBeTypeOf("number");
    // 36-character uuids plus commas: the cap must keep the comma-joined id list far below a gateway's URL limit (~8 KB).
    expect(SAVED_TAB_MAX! * 37).toBeLessThan(5000);
    expect(SAVED_TAB_MAX).toBeGreaterThanOrEqual(50);
  });

  it("loads at most the cap, newest saved first, and reports the true total", async () => {
    const { loadSavedRows, SAVED_TAB_MAX } = await mod();
    const { supabase, calls } = fakeApplications(250);
    const out = await need(loadSavedRows, "loadSavedRows")(supabase, "user-1");
    expect(out.rows).toHaveLength(SAVED_TAB_MAX!);
    expect(out.total).toBe(250);
    expect(out.capped).toBe(true);
    expect(calls).toContainEqual(["limit", [SAVED_TAB_MAX]]);
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(calls).toContainEqual(["eq", ["stage", "saved"]]);
    expect(calls).toContainEqual(["eq", ["user_id", "user-1"]]);
    // Newest first: the cap keeps the most recently saved, not the oldest.
    expect(out.rows[0].id).toBe("a249");
  });

  it("asks the database for the exact count in the same query (no second round trip)", async () => {
    const { loadSavedRows } = await mod();
    const { supabase, calls } = fakeApplications(10);
    await need(loadSavedRows, "loadSavedRows")(supabase, "u");
    const select = calls.find(([n]) => n === "select");
    expect(select?.[1][1]).toEqual({ count: "exact" });
  });

  it("is not capped when the set is within the cap", async () => {
    const { loadSavedRows } = await mod();
    const { supabase } = fakeApplications(7);
    const out = await need(loadSavedRows, "loadSavedRows")(supabase, "u");
    expect(out.rows).toHaveLength(7);
    expect(out.total).toBe(7);
    expect(out.capped).toBe(false);
  });

  it("the ids it hands to the postings query stay under the cap, so the lookup URL stays small", async () => {
    const { loadSavedRows, partitionSavedSet, buildSavedPostingsQuery } = await mod();
    const { supabase } = fakeApplications(250);
    const { rows } = await need(loadSavedRows, "loadSavedRows")(supabase, "u");
    const ids = rows.flatMap((r) => (r.job_posting_id ? [r.job_posting_id] : []));
    expect(ids.join(",").length).toBeLessThan(5000);
    // And the partition over a full page is cheap and total: every loaded row is accounted for exactly once.
    const { openPostingIds, entries } = need(partitionSavedSet, "partitionSavedSet")(rows, []);
    expect(openPostingIds.length + entries.length).toBe(rows.length);
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (...a: unknown[]) => (calls.push([String(p), a]), chain) });
    need(buildSavedPostingsQuery, "buildSavedPostingsQuery")({ from: () => chain }, ids, "id", { workTypes: [], seniorities: [] });
    const inId = calls.find(([n, a]) => n === "in" && a[0] === "id");
    expect((inId![1][1] as string[]).length).toBeLessThanOrEqual(rows.length);
  });
});

describe("savedCapNotice: tells the user the list is partial, and where the rest is", () => {
  it("says nothing when everything is shown", async () => {
    const { savedCapNotice } = await mod();
    expect(need(savedCapNotice, "savedCapNotice")({ total: 7, loaded: 7 })).toBeNull();
  });

  it("when capped, says how many are shown and how many are not, and points at the tracker", async () => {
    const { savedCapNotice } = await mod();
    const msg = need(savedCapNotice, "savedCapNotice")({ total: 250, loaded: 100 });
    expect(msg).toContain("100");
    expect(msg).toContain("150");
    expect(msg).toMatch(/tracker/i);
  });

  it("uses the singular properly for one hidden job", async () => {
    const { savedCapNotice } = await mod();
    expect(need(savedCapNotice, "savedCapNotice")({ total: 101, loaded: 100 })).toMatch(/The other 1 saved job is in your tracker/);
  });
});
