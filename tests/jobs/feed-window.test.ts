/**
 * FEED-PERF-1 (P4): the Recommended and External tabs read their whole filtered window as NARROW rows (Read A), rank it, and load full cards only for the page they show (Read B).
 *
 * What this pins, against a reference that is the pipeline as it was (score, sort, promoted reorder, cap, over full rows):
 *   - page 1 is exactly the old top 24, promoted slots included; page 2 and later continue with no gap and no repeat, and a promoted card appears on page 1 only;
 *   - the whole window is scored and returned (what Auto-Apply and the match-score cache read), not the page; the hard cap is applied AFTER scoring and ranking;
 *   - Read B's cards come back in ranked order whatever order the database returns them in, and a card closed between the two reads is dropped without a gap in the others;
 *   - a page is at most 24 cards, at most 26 with the promoted ones, and a Read A row stays under its byte budget;
 *   - a narrow row carries everything the country counts and the suggestion index read, so those stay what they were.
 * The page itself (an async Server Component) cannot be rendered here; its wiring is pinned in feed-window-wiring.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FEED_PAGE_SIZE,
  RANK_COLUMNS,
  RECOMMENDED_HARD_CAP,
  attachFullRows,
  pageReadIds,
  rankFeedWindow,
  selectPage,
  toRankRow,
  type RankRow,
} from "@/lib/jobs/feed-window";
import { scoreJobs, type ScoredJob } from "@/lib/matching/compute-and-store";
import { sortFeedResults } from "@/lib/jobs/ranking";
import { buildSuggestionIndex } from "@/lib/jobs/search-suggestions";
import { deriveCountry } from "@/lib/jobs/country";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

const NOW = new Date("2026-11-07T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const SKILL_POOL = ["react", "typescript", "node.js", "sql", "python", "aws", "docker", "figma", "excel", "sales", "seo", "go", "rust", "java", "kotlin", "swift"];
const RESUME: StructuredResume = { ...EMPTY_RESUME, skills: ["react", "typescript", "node.js", "sql", "aws"] };

/** A deterministic board: varied skills, seniority and age, so the ranking has real work to do and real ties. */
function board(n: number): RankRow[] {
  return Array.from({ length: n }, (_, i) => {
    const skillCount = 1 + (i % 6);
    const skills = Array.from({ length: skillCount }, (_, k) => SKILL_POOL[(i * 3 + k * 5) % SKILL_POOL.length]);
    return {
      id: `job-${String(i).padStart(4, "0")}`,
      posted_at: new Date(NOW - (i % 28) * DAY - (i % 7) * 3_600_000).toISOString(),
      title: `Role ${i}`,
      company_name: `Company ${i % 9}`,
      location: i % 4 === 0 ? "Lagos, Nigeria" : i % 4 === 1 ? "Remote" : i % 4 === 2 ? "Accra, Ghana" : "Nairobi, Kenya",
      external_source: i % 2 === 0 ? "schema-org:workable-nigeria" : null,
      work_type: i % 4 === 1 ? "remote" : "onsite",
      seniority: (["junior", "mid", "senior", null] as const)[i % 4],
      structured_jd: { skills },
    } as RankRow;
  });
}

/** The pipeline as it was in the feed page, over full rows: score, sort, promoted reorder, cap. The reference everything below is compared with. */
function legacyOrder(rows: RankRow[], tab: string, hasQ: boolean, promotedIds: string[], cap = RECOMMENDED_HARD_CAP): ScoredJob<RankRow>[] {
  const scored = scoreJobs(RESUME, rows);
  sortFeedResults(scored, tab, hasQ, WINDOW_DAYS);
  const present = new Set(scored.map((s) => s.job.id));
  const visible = promotedIds.filter((id) => present.has(id));
  if (visible.length > 0) {
    const rank = new Map(visible.map((id, i) => [id, i]));
    scored.sort((a, b) => {
      const ra = rank.get(a.job.id);
      const rb = rank.get(b.job.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return 0;
    });
  }
  scored.length = Math.min(scored.length, cap);
  return scored;
}
const ids = (xs: { job: { id: string } }[]) => xs.map((x) => x.job.id);
const opts = (extra: Partial<Parameters<typeof rankFeedWindow>[2]> = {}) => ({ tab: "recommended", hasSearchTerm: false, freshnessWindowDays: WINDOW_DAYS, promotedIds: [] as string[], ...extra });

// The ranking reads the clock (freshness decay), so it is pinned for every test in this file.
const realNow = Date.now;
beforeAll(() => {
  Date.now = () => NOW;
});
afterAll(() => {
  Date.now = realNow;
});

describe("page 1 is the old top 24, and later pages continue it", () => {
  const rows = board(120);
  const promoted = [rows[88].id, rows[7].id];

  it("POSITIVE CONTROL: the board is big enough that paging happens and the ranking is not just input order", () => {
    const { ranked } = rankFeedWindow(RESUME, rows, opts());
    expect(ranked).toHaveLength(120);
    expect(ids(ranked)).not.toEqual(rows.map((r) => r.id));
  });

  for (const tab of ["recommended", "external"]) {
    it(`${tab}: page 1 equals the top 24 of the old pipeline, with the promoted cards in slots 0 and 1`, () => {
      const p = tab === "recommended" ? promoted : [];
      const { ranked } = rankFeedWindow(RESUME, rows, opts({ tab, promotedIds: p }));
      const first = selectPage(ranked, 1);
      expect(ids(first.items)).toEqual(ids(legacyOrder(rows, tab, false, p)).slice(0, FEED_PAGE_SIZE));
      if (p.length) expect(ids(first.items).slice(0, 2)).toEqual(p);
    });
  }

  it("every page together is the whole ranked list: no gap, no repeat, and the promoted cards sit on page 1 only", () => {
    const { ranked } = rankFeedWindow(RESUME, rows, opts({ promotedIds: promoted }));
    const first = selectPage(ranked, 1);
    const seen: string[] = [];
    for (let p = 1; p <= first.totalPages; p += 1) {
      const page = selectPage(ranked, p);
      expect(page.items.length, `page ${p}`).toBeLessThanOrEqual(FEED_PAGE_SIZE);
      seen.push(...ids(page.items));
      if (p > 1) for (const id of promoted) expect(ids(page.items), `page ${p}`).not.toContain(id);
    }
    expect(seen).toEqual(ids(legacyOrder(rows, "recommended", false, promoted)));
    expect(new Set(seen).size).toBe(seen.length);
    expect(first.totalPages).toBe(5);
    expect(first.total).toBe(120);
  });

  it("a page past the end shows the last page, and a page below 1 shows the first", () => {
    const { ranked } = rankFeedWindow(RESUME, rows, opts());
    expect(selectPage(ranked, 99).page).toBe(5);
    expect(ids(selectPage(ranked, 99).items)).toEqual(ids(ranked.slice(96)));
    expect(selectPage(ranked, 0).page).toBe(1);
    expect(selectPage(ranked, Number.NaN).page).toBe(1);
  });

  it("a promoted id that is not in the window is dropped, never invented, and the rest keep their order", () => {
    const { ranked, promotedPresent } = rankFeedWindow(RESUME, rows, opts({ promotedIds: ["not-in-window", rows[50].id] }));
    expect(promotedPresent).toEqual([rows[50].id]);
    expect(ids(ranked)[0]).toBe(rows[50].id);
    expect(ids(ranked)).not.toContain("not-in-window");
  });

  it("with a search term the tab's own ranking is skipped (the search order stands) and the promoted reorder still applies", () => {
    const { ranked } = rankFeedWindow(RESUME, rows, opts({ hasSearchTerm: true, promotedIds: [rows[30].id] }));
    expect(ids(ranked)).toEqual(ids(legacyOrder(rows, "recommended", true, [rows[30].id])));
    expect(ids(ranked).slice(1, 4)).toEqual([rows[0].id, rows[1].id, rows[2].id]);
  });
});

describe("the whole window is scored; the cap comes after", () => {
  it("returns every row of the window, scored, not the page: this is what the match-score cache and Auto-Apply are fed", () => {
    const rows = board(120);
    const { ranked } = rankFeedWindow(RESUME, rows, opts());
    expect(ranked).toHaveLength(120);
    expect(new Set(ids(ranked))).toEqual(new Set(rows.map((r) => r.id)));
    for (const s of ranked) {
      expect(typeof s.score).toBe("number");
      expect(s.explanation).toBeTruthy();
    }
    expect(selectPage(ranked, 1).items).toHaveLength(FEED_PAGE_SIZE);
  });

  it("the hard cap trims the TAIL of the ranked list: the best row survives even when it is last in the input", () => {
    const rows = board(12);
    // The best match for the resume, placed LAST (and so first to be cut by a cap applied to the input).
    const best: RankRow = { ...rows[0], id: "best-last", title: "Full stack", seniority: null, structured_jd: { skills: ["react", "typescript", "node.js", "sql", "aws"] } };
    const input = [...rows, best];
    const { ranked } = rankFeedWindow(RESUME, input, opts({ hardCap: 5 }));
    expect(ranked).toHaveLength(5);
    expect(ids(ranked)).toEqual(ids(legacyOrder(input, "recommended", false, [], 5)));
    expect(ids(ranked)).toContain("best-last");
  });

  it("the default cap is the one the feed has always had", () => {
    expect(RECOMMENDED_HARD_CAP).toBe(2000);
  });
});

describe("Read B: the page's cards in ranked order", () => {
  const rows = board(30);
  const { ranked } = rankFeedWindow(RESUME, rows, opts({ promotedIds: [rows[20].id] }));
  const pageRanked = selectPage(ranked, 1).items;
  const full = (id: string) => ({ ...rows.find((r) => r.id === id)!, description: `full ${id}` });

  it("returns the cards in the ranked order whatever order the database sent them in", () => {
    const shuffled = pageRanked.map((s) => full(s.job.id)).reverse();
    const cards = attachFullRows(pageRanked, shuffled);
    expect(ids(cards)).toEqual(ids(pageRanked));
    expect(cards[0].job.description).toBe(`full ${rows[20].id}`);
    expect(cards.map((c) => c.score)).toEqual(pageRanked.map((s) => s.score));
  });

  it("a card that closed between the two reads is dropped and the others keep their order", () => {
    const missing = pageRanked[3].job.id;
    const cards = attachFullRows(pageRanked, pageRanked.filter((s) => s.job.id !== missing).map((s) => full(s.job.id)));
    expect(ids(cards)).toEqual(ids(pageRanked).filter((id) => id !== missing));
  });

  it("asks for the page's ids and nothing else: at most 24, at most 26 with the promoted cards shown, no duplicates", () => {
    const idsAsked = pageReadIds(ids(pageRanked), [rows[20].id]);
    expect(idsAsked).toEqual(ids(pageRanked));
    expect(idsAsked.length).toBeLessThanOrEqual(FEED_PAGE_SIZE);
    const withExtra = pageReadIds(ids(pageRanked), ["extra-1", "extra-2", rows[20].id]);
    expect(withExtra.length).toBeLessThanOrEqual(FEED_PAGE_SIZE + 2);
    expect(new Set(withExtra).size).toBe(withExtra.length);
  });
});

describe("Read A rows", () => {
  it("name exactly the columns ranking, the country counts and the suggestion index read, and take the skills out of structured_jd rather than the whole column", () => {
    expect(RANK_COLUMNS).toBe("id, posted_at, title, company_name, location, external_source, work_type, seniority, jd_skills:structured_jd->skills");
    expect(RANK_COLUMNS).not.toMatch(/\bdescription\b|\bdescription_preview\b|\bstructured_jd,|\bstructured_jd$|external_url|apply_email|salary/);
  });

  it("stay under 600 bytes a row for a posting with 16 tags, as the database would send them", () => {
    const raw = { id: "0b1f6d8e-6e0a-4f6e-9c2e-2f6f6a1c9b11", posted_at: "2026-11-05T10:21:44.123456+00:00", title: "Senior Backend Engineer (Payments Platform)", company_name: "Moniepoint", location: "Lagos, Nigeria; Remote", external_source: "schema-org:workable-nigeria", work_type: "hybrid", seniority: "senior", jd_skills: SKILL_POOL };
    const bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
    expect(bytes).toBeLessThanOrEqual(600);
  });

  it("toRankRow turns the skills array back into the structured_jd shape scoring reads, and tolerates a missing or odd value", () => {
    const base = { id: "a", posted_at: "2026-11-01T00:00:00Z", title: "t", company_name: "c", location: null, external_source: null, work_type: null, seniority: null };
    expect(toRankRow({ ...base, jd_skills: ["react", "sql"] }).structured_jd).toEqual({ skills: ["react", "sql"] });
    expect(toRankRow({ ...base, jd_skills: null }).structured_jd).toBeNull();
    expect(toRankRow({ ...base, jd_skills: "react" }).structured_jd).toBeNull();
    expect(toRankRow({ ...base, jd_skills: ["react", 4, null, "sql"] }).structured_jd).toEqual({ skills: ["react", "sql"] });
  });

  it("carry what the country counts and the suggestion index read: both give the same answer as over full rows", () => {
    const rows = board(80);
    const fullRows = rows.map((r) => ({ ...r, description: "x".repeat(300), external_url: "https://example.test/j", salary_min: 1 }));
    expect(rows.map((r) => deriveCountry(r))).toEqual(fullRows.map((r) => deriveCountry(r)));
    expect(buildSuggestionIndex(rows)).toEqual(buildSuggestionIndex(fullRows));
  });
});
