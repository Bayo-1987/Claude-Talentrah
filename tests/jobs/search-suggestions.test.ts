/**
 * The feed's search suggestions.
 *
 * ── THE BUG THESE WERE WRITTEN AGAINST ────────────────────────────────────
 *
 * The obvious implementation counts how often each value occurs. That number
 * is wrong the moment it is clicked, and the live board makes it wrong by a
 * lot: `location` holds semicolon-joined lists, so "Lagos, Nigeria" occurs as
 * its own value 21 times while `searchJobs` — a substring match over title +
 * company + location — returns 28, because "Remote, Lagos, Nigeria" and
 * "Lagos, Nigeria; Remote, Nigeria" contain it too.
 *
 * A count beside a suggestion is a promise about what clicking it does. These
 * tests exist to keep the count and the promise the same number.
 */
import { describe, expect, it } from "vitest";
import {
  buildSuggestionIndex,
  defaultSuggestions,
  filterSuggestions,
} from "@/lib/jobs/search-suggestions";
import { searchJobs } from "@/lib/jobs/search";
import type { Tables } from "@/lib/supabase/types";

type Job = Tables<"job_postings">;

let n = 0;
const job = (title: string, company: string, location: string): Job =>
  ({
    id: `job-${n++}`,
    title,
    company_name: company,
    location,
    status: "open",
    description: "x",
    posted_at: "2026-08-01T00:00:00.000Z",
    structured_jd: {},
  }) as unknown as Job;

// Shapes taken from the live board, including the awkward ones.
const BOARD: Job[] = [
  job("Backend Engineer", "Zaria Digital", "Lagos, Nigeria"),
  job("Senior Product Manager", "Zaria Digital", "Lagos, Nigeria"),
  job("Data Analyst - Fraud", "Moniepoint", "Remote, Lagos, Nigeria"),
  job("Data Analyst - Fraud", "Moniepoint", "Lagos, Nigeria; Remote, Nigeria"),
  job("Field Credit Officer", "Moniepoint", "Kano, Nigeria; Katsina, Nigeria; Jigawa, Nigeria"),
  job("Content Designer", "Reliance Health", "Remote, Kenya"),
];

describe("counts are what the search will actually return", () => {
  it.each(["Lagos, Nigeria", "Kano, Nigeria", "Moniepoint", "Data Analyst - Fraud"])(
    "%s: the suggested count equals searchJobs' result count",
    (value) => {
      const index = buildSuggestionIndex(BOARD);
      const suggestion = index.find((s) => s.value === value);
      expect(suggestion, `${value} was never suggested`).toBeDefined();
      expect(suggestion!.count).toBe(searchJobs(BOARD, value).length);
    },
  );

  it("counts Lagos across the joined forms, not just the exact cell", () => {
    // 4 postings contain "Lagos, Nigeria": two plain, one "Remote, Lagos,
    // Nigeria", one "Lagos, Nigeria; Remote, Nigeria". A frequency count of
    // the atomic value would say 2 and be wrong by half.
    const index = buildSuggestionIndex(BOARD);
    expect(index.find((s) => s.value === "Lagos, Nigeria")!.count).toBe(4);
  });
});

describe("locations are split, because the joined string is not a search anyone runs", () => {
  it("offers each place separately rather than the ninety-character list", () => {
    const values = buildSuggestionIndex(BOARD)
      .filter((s) => s.kind === "location")
      .map((s) => s.value);
    expect(values).toContain("Kano, Nigeria");
    expect(values).toContain("Katsina, Nigeria");
    expect(values).not.toContain("Kano, Nigeria; Katsina, Nigeria; Jigawa, Nigeria");
  });

  it("every suggested location still finds at least one posting", () => {
    // A split that produced a value no search could match would be a dead row.
    for (const s of buildSuggestionIndex(BOARD)) {
      expect(searchJobs(BOARD, s.value).length, `${s.value} matched nothing`).toBeGreaterThan(0);
    }
  });
});

describe("ranking", () => {
  it("puts prefix matches above substring matches", () => {
    // "Data Analyst - Fraud" starts with the query; "Senior Data Scientist"
    // merely contains it. Someone typing expects the former first even when
    // the latter matches more postings.
    const board = [
      ...BOARD,
      job("Senior Data Scientist", "Moniepoint", "Remote, Nigeria"),
      job("Senior Data Scientist", "Moniepoint", "Remote, Nigeria"),
      job("Senior Data Scientist", "Moniepoint", "Remote, Nigeria"),
    ];
    const titles = filterSuggestions(buildSuggestionIndex(board), "data").filter(
      (s) => s.kind === "title",
    );
    expect(titles[0].value).toBe("Data Analyst - Fraud");
  });

  it("never returns more than 10, nor more than 5 from one group", () => {
    const board = Array.from({ length: 40 }, (_, i) =>
      job(`Engineer ${i}`, `Engineering Co ${i}`, `Engineerton ${i}, Nigeria`),
    );
    const out = filterSuggestions(buildSuggestionIndex(board), "engineer");
    expect(out.length).toBeLessThanOrEqual(10);
    for (const kind of ["title", "company", "location"] as const) {
      expect(out.filter((s) => s.kind === kind).length).toBeLessThanOrEqual(5);
    }
  });

  it("fills the total round-robin, so one group cannot crowd the others out", () => {
    /*
     * The failure this pins: 5 titles + 5 companies would fill the cap of 10
     * by straight truncation and locations would never appear, even with
     * perfectly good matches.
     */
    const board = Array.from({ length: 40 }, (_, i) =>
      job(`Engineer ${i}`, `Engineering Co ${i}`, `Engineerton ${i}, Nigeria`),
    );
    const out = filterSuggestions(buildSuggestionIndex(board), "engineer");
    for (const kind of ["title", "company", "location"] as const) {
      expect(out.some((s) => s.kind === kind), `${kind} was crowded out`).toBe(true);
    }
  });

  it("returns nothing for an empty query — the untyped list is a different list", () => {
    expect(filterSuggestions(buildSuggestionIndex(BOARD), "   ")).toEqual([]);
  });

  it("is case-insensitive", () => {
    const index = buildSuggestionIndex(BOARD);
    expect(filterSuggestions(index, "LAGOS").length).toBe(filterSuggestions(index, "lagos").length);
  });
});

describe("the untyped list", () => {
  const index = buildSuggestionIndex(BOARD);
  const defaults = defaultSuggestions(index);

  it("is locations and a couple of titles, computed from the current board", () => {
    expect(defaults.filter((s) => s.kind === "location").length).toBeGreaterThan(0);
    expect(defaults.filter((s) => s.kind === "title").length).toBe(2);
  });

  it("shows no companies", () => {
    /*
     * One employer is 131 of the 155 open postings on the live board, so a
     * top-companies list is that employer plus noise and reads as an advert.
     */
    expect(defaults.some((s) => s.kind === "company")).toBe(false);
  });

  it("leads with the highest-volume locations", () => {
    const locations = defaults.filter((s) => s.kind === "location");
    const counts = locations.map((s) => s.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("is derived only from postings — nothing about any visitor", () => {
    // The guard against "recent searches" creeping back in. Every value in
    // the untyped list must be traceable to a posting on the board.
    for (const s of defaults) {
      expect(searchJobs(BOARD, s.value).length, `${s.value} came from nowhere`).toBeGreaterThan(0);
    }
  });
});
