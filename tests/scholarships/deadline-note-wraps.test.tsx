/**
 * QA-3: a long unbroken token in a scholarship's deadline note must wrap, never widen the page.
 *
 * QA's 360px sweep of every public URL found three pages scrolling sideways (403, 403 and 396 px wide) from one listing whose deadline note carries a long URL-like path,
 * "(amherst.edu/admission/apply/firstyear/calendar_deadlines)". The note is data, so any listing can do it. The value span is where the text renders on all four
 * surfaces (the card, the detail page and the landing row through DeadlineLine; the public row on /scholarships/fully-funded and /scholarships/degree/[level] by itself),
 * so that is where the wrapping class lives: `wrap-anywhere` (overflow-wrap:anywhere), not `break-words`, because only `anywhere` also lowers the span's min-content width,
 * which is what a flex column item sizes by. jsdom has no layout, so this pins the class on the element that holds the token; e2e/scholarship-landing-overflow.spec.ts measures
 * scrollWidth in a browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/scholarships/save-toggle", () => ({ SaveToggle: () => null }));
vi.mock("@/components/scholarships/save-status-select", () => ({ SaveStatusSelect: () => null }));
vi.mock("@/components/scholarships/farah-actions", () => ({ FarahActions: () => null }));
vi.mock("@/components/scholarships/scholarship-share-button", () => ({ ScholarshipShareButton: () => null }));

import { DeadlineLine } from "@/components/scholarships/deadline-line";
import { PublicScholarshipRow } from "@/components/scholarships/public-scholarship-row";
import { ScholarshipCard } from "@/components/scholarships/scholarship-card";

/** An invented long token in the shape of the real one (a parenthesised path with no spaces or hyphens to break at). */
const TOKEN = "(example.test/admission/apply/firstyear/calendar_deadlines_for_the_fall_twenty_twenty_seven_enrollment_cycle_overview)";
const NOTE = `Provider calendar ${TOKEN}, deadlines vary by partner.`;
const STAMP = "2026-09-09T08:47:31.534Z";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  provider: "Example Foundation",
  program_name: "Example Scholarship",
  host_institution: "Example University",
  degree_levels: ["msc"],
  field_tags: [],
  funding_type: "full",
  funding_covers: [],
  eligibility_nationalities: [],
  eligibility_prior_degree: null,
  eligibility_age: null,
  eligibility_other: null,
  application_deadline: null,
  close_time: null,
  close_tz: null,
  close_at: null,
  cycle_year: 2027,
  official_url: "https://example.test/apply",
  source_name: "Example",
  moderation_status: "verified",
  deadline_note: NOTE,
  deadline_verified_at: STAMP,
};
const row = { ...base } as never;

/** The class list of the innermost element whose own text contains the token. */
function classHolding(html: string, needle: string): string {
  const i = html.indexOf(needle);
  if (i === -1) throw new Error(`the markup does not contain the token:\n${html.slice(0, 400)}`);
  const open = html.lastIndexOf("<", i);
  const tag = /^<[a-z0-9]+[^>]*>/.exec(html.slice(open));
  if (!tag) throw new Error("no opening tag before the token");
  return /class="([^"]*)"/.exec(tag[0])?.[1] ?? "";
}
const wraps = (cls: string) => cls.split(/\s+/).includes("wrap-anywhere");

describe("a long deadline-note token wraps on every surface that renders it", () => {
  it("fixture check: the note reaches the markup (the assertions below are not vacuous)", () => {
    expect(renderToStaticMarkup(<PublicScholarshipRow scholarship={row} />)).toContain(TOKEN);
  });

  it("PublicScholarshipRow (/scholarships/fully-funded, /scholarships/degree/[level])", () => {
    const html = renderToStaticMarkup(<PublicScholarshipRow scholarship={row} />);
    expect(wraps(classHolding(html, TOKEN))).toBe(true);
  });

  it("DeadlineLine, calm and urgent (detail page, landing row)", () => {
    for (const urgent of [false, true]) {
      const html = renderToStaticMarkup(<DeadlineLine text={NOTE} urgent={urgent} />);
      expect(wraps(classHolding(html, TOKEN)), `urgent=${urgent}`).toBe(true);
    }
  });

  it("DeadlineLine keeps a caller's calm class next to the wrapping class", () => {
    const html = renderToStaticMarkup(<DeadlineLine text={NOTE} urgent={false} calmClassName="text-ink-soft" valueDataAttr="value" />);
    const cls = classHolding(html, TOKEN);
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["text-ink-soft", "wrap-anywhere"]));
  });

  it("ScholarshipCard (the signed-in list)", () => {
    const html = renderToStaticMarkup(<ScholarshipCard scholarship={row} save={null} creditsBalance={0} passCovered={false} origin="https://example.test" />);
    expect(wraps(classHolding(html, TOKEN))).toBe(true);
  });
});
