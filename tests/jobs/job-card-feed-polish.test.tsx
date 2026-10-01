/**
 * send-498 — two pieces of feed-card polish from the owner's QA audit.
 *
 * 1. "Applicant count unavailable" is printed on every external card (they are applied to on someone else's site, so we
 *    have no honest count) and on any card whose count lookup failed. It is noise about something the reader cannot act
 *    on. When the count is unknown the line is now just the posting's age; a KNOWN count, zero included, still prints
 *    ("0 applicants" is a real and useful fact, and hiding it would make its absence ambiguous with "unknown").
 *
 * 2. The Save toggle's saved state was a filled heart and a changed label, nothing a sighted user could not miss at a
 *    glance and nothing a screen reader was told except through the label. It is now a real toggle: aria-pressed, and a
 *    visibly different button when pressed (border, fill and icon colour), not just a filled glyph.
 *
 * Static render of the real JobCard, the same way tests/jobs/posting-age.test.tsx does it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { IconButton } from "@/components/ui";
import type { Tables } from "@/lib/supabase/types";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function card(opts: { source?: "internal" | "external"; applicantCount?: number | null; isSaved?: boolean } = {}) {
  const source = opts.source ?? "external";
  return renderToStaticMarkup(
    <JobCard
      job={
        {
          id: "job-1",
          title: "Associate Product Manager",
          company_name: "Reliance Health",
          description: "A real posting.",
          location: "Lagos",
          work_type: null,
          seniority: null,
          external_url: "https://example.test/apply",
          status: "open",
          source_type: source,
          posted_at: daysAgo(2),
          last_checked_at: source === "external" ? daysAgo(0) : null,
        } as unknown as Tables<"job_postings">
      }
      score={75}
      isSaved={opts.isSaved ?? false}
      applicationStage={null}
      explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
      applicantCount={opts.applicantCount === undefined ? null : opts.applicantCount}
    />,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const ageLine = (html: string) => html.match(/<span[^>]*>(Posted[^<]*)<\/span>/)?.[1] ?? "";

describe("the applicant-count line", () => {
  it("is not printed on an external card (count unknown)", () => {
    const html = card({ source: "external", applicantCount: null });
    expect(html).not.toContain("Applicant count unavailable");
    expect(text(html)).not.toMatch(/applicants?\b/i);
  });

  it("is not printed when the lookup failed on an internal card either", () => {
    expect(card({ source: "internal", applicantCount: null })).not.toContain("Applicant count unavailable");
  });

  it("leaves the age line clean when the count is unknown: no dangling separator", () => {
    const line = ageLine(card({ source: "external", applicantCount: null }));
    expect(line).toMatch(/^Posted 2 days ago · re-verified today$/);
    expect(line.trim().endsWith("·")).toBe(false);
  });

  it("leaves an internal card's age line clean too", () => {
    expect(ageLine(card({ source: "internal", applicantCount: null }))).toBe("Posted 2 days ago");
  });

  it("still prints a KNOWN count: zero, one and many", () => {
    expect(ageLine(card({ source: "internal", applicantCount: 0 }))).toBe("Posted 2 days ago · 0 applicants");
    expect(ageLine(card({ source: "internal", applicantCount: 1 }))).toBe("Posted 2 days ago · 1 applicant");
    expect(ageLine(card({ source: "internal", applicantCount: 7 }))).toBe("Posted 2 days ago · 7 applicants");
  });
});

describe("the Save toggle", () => {
  const saveButton = (html: string) => html.match(/<button[^>]*aria-label="(?:Save|Unsave)"[^>]*>/)?.[0] ?? "";

  it("is a real toggle: aria-pressed is false when unsaved", () => {
    const tag = saveButton(card({ isSaved: false }));
    expect(tag).toContain('aria-label="Save"');
    expect(tag).toContain('aria-pressed="false"');
  });

  it("is aria-pressed true when saved, and its name says what pressing it does", () => {
    const tag = saveButton(card({ isSaved: true }));
    expect(tag).toContain('aria-label="Unsave"');
    expect(tag).toContain('aria-pressed="true"');
  });

  it("keeps its 40x40 hit target", () => {
    expect(saveButton(card({ isSaved: true }))).toMatch(/\bh-10\b/);
    expect(saveButton(card({ isSaved: true }))).toMatch(/\bw-10\b/);
  });
});

describe("a pressed IconButton looks different from an unpressed one, by more than its glyph", () => {
  const cls = (pressed: boolean) =>
    renderToStaticMarkup(<IconButton aria-label="Save" aria-pressed={pressed} />).match(/class="([^"]*)"/)?.[1] ?? "";

  it("carries border, fill and icon-colour rules for aria-pressed=true", () => {
    const c = cls(true);
    expect(c).toContain("aria-pressed:border-rust");
    expect(c).toContain("aria-pressed:bg-rust-soft");
    expect(c).toContain("aria-pressed:text-rust");
  });

  it("uses rust and its tint only (the design system's accent), never a fourth match-tier colour", () => {
    const c = cls(true);
    expect(c).not.toMatch(/green|amber/);
  });
});
