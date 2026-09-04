/**
 * postingAgeLine (src/lib/jobs/freshness.ts) — the always-shown "Posted N
 * days ago · re-verified M" line that replaces the old freshnessNote, which
 * only ever fired past 120 days. That threshold stops being reachable once
 * nothing older than JOB_FRESHNESS_WINDOW_DAYS (30) is ever displayed
 * anywhere — this line states the same underlying facts (an age from
 * `posted_at`, a source re-confirmation from `last_checked_at`) on every
 * card instead of only the rare stale one.
 *
 * Two properties carried over from freshnessNote and still pinned here:
 *   1. Internal postings never get "re-verified" — we are the source, and
 *      quoting our own record back as third-party confirmation is circular.
 *   2. The copy states facts, no advice, no match-tier vocabulary.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { postingAgeLine } from "@/lib/jobs/freshness";
import type { Tables } from "@/lib/supabase/types";

const NOW = new Date("2026-08-27T09:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function job(over: Partial<Tables<"job_postings">> = {}): Tables<"job_postings"> {
  return {
    source_type: "external",
    posted_at: daysAgo(2),
    last_checked_at: daysAgo(0),
    status: "open",
    ...over,
  } as unknown as Tables<"job_postings">;
}

describe("who gets the re-verified half", () => {
  it("shows both halves for an external posting with a recent check", () => {
    expect(postingAgeLine(job(), NOW)).toBe("Posted 2 days ago · re-verified today");
  });

  it("never adds re-verified for an internal posting, however recently checked", () => {
    expect(
      postingAgeLine(job({ source_type: "internal", last_checked_at: daysAgo(0) }), NOW),
    ).toBe("Posted 2 days ago");
  });

  it("omits re-verified when last_checked_at is missing, rather than guessing", () => {
    expect(postingAgeLine(job({ last_checked_at: null as unknown as string }), NOW)).toBe("Posted 2 days ago");
  });

  it("always shows the posted half, even for a brand-new posting", () => {
    expect(postingAgeLine(job({ posted_at: daysAgo(0), last_checked_at: null as unknown as string }), NOW)).toBe(
      "Posted today",
    );
  });
});

describe("re-verified reflects reality rather than hiding a stale source", () => {
  it("still shows re-verified even when the last check was a while ago", () => {
    // Unlike the old freshnessNote (which suppressed the WHOLE line past a
    // 7-day confirmation window), this line's job is to state the fact, not
    // to decide it's too embarrassing to print — a source that stopped
    // re-confirming is exactly the thing a seeker should be able to see.
    expect(postingAgeLine(job({ last_checked_at: daysAgo(14) }), NOW)).toBe(
      "Posted 2 days ago · re-verified 2 weeks ago",
    );
  });
});

describe("the copy states facts and gives no advice", () => {
  const line = postingAgeLine(job({ last_checked_at: daysAgo(14) }), NOW);

  it.each(["worth checking", "may be", "might be", "probably", "likely", "still open"])(
    "does not hedge or advise with %j",
    (phrase) => {
      expect(line.toLowerCase()).not.toContain(phrase);
    },
  );

  it("never borrows match-tier vocabulary", () => {
    for (const tier of ["excellent", "good", "fair", "stale", "expired", "dead"]) {
      expect(line.toLowerCase()).not.toContain(tier);
    }
  });
});

describe("the card actually renders it", () => {
  // JobCard calls postingAgeLine(job) with no `now` override, so it always
  // measures against the REAL current time — these fixtures must too,
  // unlike the fixed historical NOW the pure-function tests above use.
  const realDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

  function card(over: Partial<Tables<"job_postings">> = {}) {
    return renderToStaticMarkup(
      <JobCard
        job={
          {
            id: "job-1",
            title: "Associate Product Manager",
            company_name: "Reliance Health",
            description: "A real posting from an external source.",
            location: "Lagos",
            work_type: null,
            seniority: null,
            external_url: "https://example.test/apply",
            status: "open",
            source_type: "external",
            posted_at: realDaysAgo(2),
            last_checked_at: realDaysAgo(0),
            ...over,
          } as unknown as Tables<"job_postings">
        }
        score={75}
        isSaved={false}
        applicationStage={null}
        explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
        origin="https://talentrah.test"
      />,
    );
  }

  it("prints both halves on an external card", () => {
    expect(card()).toContain("Posted 2 days ago");
    expect(card()).toContain("re-verified today");
  });

  it("prints only the posted half on an internal card", () => {
    const html = card({ source_type: "internal", last_checked_at: null as unknown as string });
    expect(html).toContain("Posted 2 days ago");
    expect(html).not.toContain("re-verified");
  });

  it("sets the line in --ink-soft, not --rust", () => {
    // The reference mock used --rust for this kind of aside. Rust is the
    // "Good" match tier's colour, and CLAUDE.md forbids a fourth tier — a
    // coloured line beside a tier badge is how one arrives unintentionally.
    const html = card();
    const line = html.match(/<span[^>]*>Posted[^<]*<\/span>/)?.[0] ?? "";
    expect(line).toContain("text-ink-soft");
    expect(line).not.toContain("rust");
  });
});
