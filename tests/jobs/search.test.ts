/**
 * searchJobs — free-text search over the board already in memory.
 *
 * ── THE GAP THESE PIN ──────────────────────────────────────────────────────
 *
 * Before this, the haystack was title + company + location only. Measured on
 * production, open postings only: `excel` matched 55 postings by
 * `structured_jd.skills` and 0 by search, `sql` 44 vs. 0, `python` 38 vs. 0,
 * `kubernetes` 16 vs. 0. Someone typing the exact term a role asks for got an
 * empty board while the postings were right there — and with the skill facet
 * removed from the feed UI, search is now the only surface left that can
 * answer that query at all. These tests pin `skillsOf()` being part of the
 * haystack, not the description itself.
 */
import { describe, expect, it } from "vitest";
import { searchJobs } from "@/lib/jobs/search";
import type { Tables } from "@/lib/supabase/types";

type Job = Tables<"job_postings">;

let n = 0;
const job = (title: string, description: string, skills: string[]): Job =>
  ({
    id: `job-${n++}`,
    title,
    company_name: "Some Co",
    location: "Lagos, Nigeria",
    status: "open",
    description,
    posted_at: "2026-08-01T00:00:00.000Z",
    structured_jd: { skills },
  }) as unknown as Job;

describe("searchJobs covers structured_jd.skills", () => {
  it("finds a posting by a skill that appears in neither title, company, nor location", () => {
    const board = [
      job("Backend Engineer", "Build our core platform.", ["python", "postgresql"]),
      job("Frontend Engineer", "Build our design system.", ["react", "typescript"]),
    ];
    expect(searchJobs(board, "python")).toHaveLength(1);
    expect(searchJobs(board, "python")[0].title).toBe("Backend Engineer");
  });

  it("is case-insensitive against skills, which are stored lowercase", () => {
    const board = [job("Data Engineer", "x", ["kubernetes"])];
    expect(searchJobs(board, "Kubernetes")).toHaveLength(1);
    expect(searchJobs(board, "KUBERNETES")).toHaveLength(1);
  });

  it("still does not search the description", () => {
    // "platform" appears in the description below but nowhere in
    // title/company/location/skills — a search for it must return nothing,
    // or this has quietly become a full-text search over prose.
    const board = [job("Backend Engineer", "We build a fintech platform.", ["python"])];
    expect(searchJobs(board, "fintech")).toHaveLength(0);
  });

  it("tolerates postings with no skills array", () => {
    const board = [
      { ...job("Ops Lead", "x", []), structured_jd: {} } as unknown as Job,
    ];
    expect(() => searchJobs(board, "anything")).not.toThrow();
    expect(searchJobs(board, "anything")).toHaveLength(0);
  });

  it("still matches on title, company and location as before", () => {
    const board = [job("Backend Engineer", "x", ["python"])];
    expect(searchJobs(board, "Backend")).toHaveLength(1);
    expect(searchJobs(board, "Some Co")).toHaveLength(1);
    expect(searchJobs(board, "Lagos")).toHaveLength(1);
  });
});
