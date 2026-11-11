/**
 * FEED-PERF-1 (P4): how the feed page wires the two reads. The page is an async Server Component that cannot be rendered here (the mock ratchet forbids the module factories it would
 * need), so, like no-default-country-wiring.test.tsx, its source is read as a syntax tree. The behaviour itself (order, paging, caps, Read B ordering) is pinned in feed-window.test.ts;
 * this file pins that the page uses it in the one way that keeps scoring, ranking, counts, suggestions and the score cache over the WHOLE window.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const rel = "src/app/(app)/jobs/(feed)/page.tsx";
const text = readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = (pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);
  return out;
};
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const calls = (name: string) => all((n) => ts.isCallExpression(n) && n.expression.getText() === name) as ts.CallExpression[];
const selects = (arg: string) => all((n) => ts.isCallExpression(n) && n.expression.getText().endsWith(".select") && n.arguments[0]?.getText() === arg) as ts.CallExpression[];

/** The code of the function declaration `name` with comments removed. */
function bodyOf(name: string): string {
  const fn = all((n) => ts.isFunctionDeclaration(n) && n.name?.getText() === name)[0] as ts.FunctionDeclaration;
  expect(fn, `${name} exists`).toBeTruthy();
  return flat(fn.body!.getText().replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
}

describe("Read A", () => {
  it("the ranked tabs' window is read once, narrow (RANK_COLUMNS), and never with the card columns", () => {
    expect(selects("RANK_COLUMNS")).toHaveLength(1);
    const q = bodyOf("rankWindowQuery");
    expect(q).toContain('.from("job_postings") .select(RANK_COLUMNS)');
    expect(q).not.toContain("FEED_COLUMNS");
  });

  it("reads the window in chunks with .range(), through readWindowInChunks (a single read is cut at the API's Max rows)", () => {
    const chunked = calls("readWindowInChunks");
    expect(chunked).toHaveLength(1);
    expect(flat(chunked[0].arguments[0].getText())).toBe("(from, to) => rankWindowQuery(orgIds).range(from, to)");
    // No other, unchunked read of the window: the only call to the query is inside that lambda.
    expect(calls("rankWindowQuery")).toHaveLength(1);
    expect(flat(text)).not.toMatch(/await rankWindowQuery\(/);
  });

  it("reads in a fixed order, so ties and page boundaries are the same on every request", () => {
    expect(bodyOf("rankWindowQuery")).toContain('.order("posted_at", { ascending: false }).order("id", { ascending: true })');
  });

  it("applies exactly the discovery filters postingsQuery applies: status, the freshness floor, unlisted / admin-approved, the External source, work type and seniority", () => {
    const a = bodyOf("postingsQuery");
    const b = bodyOf("rankWindowQuery");
    const clauses = [
      '.eq("status", "open")',
      '.gte("posted_at", jobDateFilterSinceISO(posted))',
      "unlisted_at.is.null,organization_id.in.(${viewerOrgIds.join(\",\")}),admin_review_decision.eq.approved",
      'query.or("unlisted_at.is.null,admin_review_decision.eq.approved")',
      'if (tab === "external") query = query.eq("source_type", "external");',
      'query.in("work_type", workTypes)',
      'query.in("seniority", seniorities)',
    ];
    for (const c of clauses) {
      expect(a, `postingsQuery has ${c}`).toContain(c);
      expect(b, `rankWindowQuery has ${c}`).toContain(c);
    }
  });

  it("is used for every tab except Most Recent and Saved, and only the ranked path reads it", () => {
    expect(flat(text)).toContain('const usesRankWindow = tab !== "recent" && tab !== "saved";');
    expect(flat(text)).toContain("const isRankedPaged = usesRankWindow && !q;");
    expect(calls("rankWindowQuery")).toHaveLength(1);
  });
});

describe("the whole window is ranked and stored; only the page is drawn", () => {
  const ranking = () => {
    const decls = all((n) => ts.isVariableDeclaration(n) && !!n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText() === "rankFeedWindow") as ts.VariableDeclaration[];
    expect(decls, "rankFeedWindow is destructured once").toHaveLength(1);
    const names: Record<string, string> = {};
    for (const el of (decls[0].name as ts.ObjectBindingPattern).elements) names[(el.propertyName ?? el.name).getText()] = el.name.getText();
    return { call: decls[0].initializer as ts.CallExpression, ranked: names.ranked, promotedPresent: names.promotedPresent };
  };

  it("scores and ranks every row of the window in one call (no scoreJobs, no cap or slice of its own before it)", () => {
    expect(calls("scoreJobs"), "the page scores through rankFeedWindow only").toHaveLength(0);
    expect(all((n) => ts.isIdentifier(n) && n.text === "RECOMMENDED_HARD_CAP"), "the cap is applied inside rankFeedWindow, after scoring and ranking, and nowhere else").toHaveLength(0);
    const { call } = ranking();
    expect(call.arguments.map((a) => flat(a.getText()).slice(0, 12))[0]).toBe("resume");
    expect(call.arguments[1].getText()).toBe("jobs");
    expect(flat(call.arguments[2].getText())).toContain("promotedIds: (promoted ?? []).map((p) => p.jobPostingId)");
  });

  it("persists the WHOLE ranked window to the match-score cache, not the page", () => {
    const persist = calls("persistMatchScores");
    expect(persist).toHaveLength(1);
    expect(persist[0].arguments[1].getText()).toBe(ranking().ranked);
  });

  it("slices the page from the ranked list, so the promoted reorder is already in it", () => {
    expect(flat(text)).toContain(`selectPage(${ranking().ranked}, Number(params.page ?? "1"))`);
  });

  it("shows, bills and attributes a promoted card on page 1 only", () => {
    const f = flat(text);
    expect(f).toContain(`const shownPromoted = new Set(feedPage && feedPage.page > 1 ? [] : ${ranking().promotedPresent});`);
    expect(f).toContain("const visiblePromoted = promoted ? promoted.filter((p) => shownPromoted.has(p.jobPostingId)) : null;");
    expect(calls("recordPromotedImpressions")[0].arguments[1].getText()).toBe("visiblePromoted");
  });
});

describe("Read B", () => {
  it("loads the card columns for the page's ids only, open postings only, and puts them back in ranked order", () => {
    // The whole chain, as one expression: a call whose own text starts at `supabase` and contains the Read B filter.
    const chains = all((n) => ts.isCallExpression(n) && n.getText().startsWith("supabase") && n.getText().includes('.in("id", readBIds)')) as ts.CallExpression[];
    const outer = chains.filter((c) => !chains.includes(c.parent.parent as ts.CallExpression));
    expect(outer, "one Read B").toHaveLength(1);
    expect(flat(outer[0].getText())).toBe('supabase.from("job_postings").select(FEED_COLUMNS).in("id", readBIds).eq("status", "open")');
    expect(flat(text)).toContain("const readBIds = feedPage ? pageReadIds(pageRanked.map((s) => s.job.id), promotedIds) : [];");
    expect(flat(text)).toContain("attachFullRows(pageRanked, (readB?.data ?? []) as FeedJobPosting[])");
  });

  it("is the only new card read: the other FEED_COLUMNS reads are Most Recent's page, its search-term window and the Saved set, which are unchanged", () => {
    expect(selects("FEED_COLUMNS")).toHaveLength(3);
    expect(flat(text)).toContain("buildSavedPostingsQuery(supabase, ids, FEED_COLUMNS");
    expect(flat(text)).toContain('supabase.rpc("search_job_postings"');
    expect(calls("paginatedRecentQuery").length).toBeGreaterThan(0);
  });

  it("counts applicants for the ids drawn, never for the whole window", () => {
    expect(calls("loadApplicantCounts").map((c) => c.arguments[0].getText()).sort()).toEqual(["cards", "unpagedCards"]);
  });
});

describe("Previous and Next 24 jobs", () => {
  it("are plain links to ?page= (no client code), on the tab the reader is on", () => {
    expect(text.startsWith('"use client"')).toBe(false);
    const f = flat(text);
    expect(f).toContain("href={buildRecentPageHref(feedPage.page - 1, tab)}");
    expect(f).toContain("href={buildRecentPageHref(feedPage.page + 1, tab)}");
    expect(f).toContain("Next {FEED_PAGE_SIZE} jobs");
    expect(f).toMatch(/Previous\s*<\/a>/);
    expect(text).not.toMatch(/Show more/);
  });
});
