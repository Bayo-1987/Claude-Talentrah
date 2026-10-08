/**
 * #594 — a reviewer's note must never render as a deadline.
 *
 * `scholarships.deadline_note` is the copy an applicant reads in place of a date when a provider genuinely has no single deadline, and the model says it is
 * valid only alongside a verified-deadline stamp (`deadline_verified_at`; src/lib/scholarships/types.ts). Nothing enforced that, and a listing went public
 * with a reviewer's "A human should confirm this date before publishing" as its deadline, on every surface at once. So there is ONE function that decides
 * whether a note may be shown, `publicDeadlineNote()`, it FAILS CLOSED (no stamp, or a stamp that was not even selected, means no note), and every public
 * surface goes through it. A ratchet fails the build if any file in src/ reads `.deadline_note` any other way.
 *
 * The fixture note is invented and reviewer-addressed, never the real listing's text.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/scholarships/save-toggle", () => ({ SaveToggle: () => null }));
vi.mock("@/components/scholarships/save-status-select", () => ({ SaveStatusSelect: () => null }));
vi.mock("@/components/scholarships/farah-actions", () => ({ FarahActions: () => null }));
vi.mock("@/components/scholarships/scholarship-share-button", () => ({ ScholarshipShareButton: () => null }));

import { deadlineNoteOrFallback, publicDeadlineNote } from "@/lib/scholarships/public-deadline-note";
import { scholarshipMetaDescription } from "@/lib/scholarships/meta-description";
import { ScholarshipCard } from "@/components/scholarships/scholarship-card";
import { PublicScholarshipRow } from "@/components/scholarships/public-scholarship-row";
import { deadlineDisplay } from "@/components/scholarships/public-landing";
import { factCardHtml } from "@/lib/blog/scholarship-embed";
import { PUBLIC_COLUMNS } from "@/lib/scholarships/public";

const REVIEWER_NOTE = "Reported by a secondary source. NOT verified against the official page: a human should confirm this date before publishing.";
const GOOD_NOTE = "Varies by partner institution: each partner sets its own deadline.";
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
  deadline_note: null,
  deadline_verified_at: null,
};
const row = (over: Record<string, unknown>) => ({ ...base, ...over }) as never;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("publicDeadlineNote: the one decision", () => {
  it("returns a note only when the deadline has a verified stamp", () => {
    expect(publicDeadlineNote({ deadline_note: GOOD_NOTE, deadline_verified_at: STAMP })).toBe(GOOD_NOTE);
    expect(publicDeadlineNote({ deadline_note: REVIEWER_NOTE, deadline_verified_at: null })).toBeNull();
  });

  it("FAILS CLOSED: a stamp that was not even selected is no stamp", () => {
    expect(publicDeadlineNote({ deadline_note: REVIEWER_NOTE })).toBeNull();
    expect(publicDeadlineNote({ deadline_note: REVIEWER_NOTE, deadline_verified_at: undefined })).toBeNull();
  });

  it("returns null for a missing or blank note, and trims a real one", () => {
    expect(publicDeadlineNote({ deadline_note: null, deadline_verified_at: STAMP })).toBeNull();
    expect(publicDeadlineNote({ deadline_note: "   ", deadline_verified_at: STAMP })).toBeNull();
    expect(publicDeadlineNote({ deadline_note: `  ${GOOD_NOTE}  `, deadline_verified_at: STAMP })).toBe(GOOD_NOTE);
  });

  it("deadlineNoteOrFallback says 'Not published yet' instead of an unverified note", () => {
    expect(deadlineNoteOrFallback({ deadline_note: REVIEWER_NOTE, deadline_verified_at: null })).toBe("Not published yet");
    expect(deadlineNoteOrFallback({ deadline_note: GOOD_NOTE, deadline_verified_at: STAMP })).toBe(GOOD_NOTE);
    expect(deadlineNoteOrFallback({ deadline_note: null, deadline_verified_at: STAMP })).toBe("Not published yet");
  });
});

describe("every public surface: an unverified note never appears, a verified one still does, a real date wins", () => {
  const unverified = row({ deadline_note: REVIEWER_NOTE });
  const verified = row({ deadline_note: GOOD_NOTE, deadline_verified_at: STAMP });
  const dated = row({ application_deadline: "2027-02-28", deadline_note: REVIEWER_NOTE });

  const card = (r: never) => text(renderToStaticMarkup(<ScholarshipCard scholarship={r} save={null} creditsBalance={0} passCovered={false} origin="https://www.talentrah.com" />));
  const listRow = (r: never) => text(renderToStaticMarkup(<PublicScholarshipRow scholarship={r} />));

  it.each([
    ["the scholarship list card", card],
    ["the public landing rows (PublicScholarshipRow)", listRow],
    ["the blog fact card", (r: never) => text(factCardHtml("id-1", r))],
    ["the landing page's own deadline line", (r: never) => deadlineDisplay(r).text],
    ["the SEO meta description", (r: never) => scholarshipMetaDescription(r)],
  ])("%s", (_name, render) => {
    const bad = render(unverified);
    expect(bad).not.toContain("human should");
    expect(bad).not.toContain("NOT verified");
    expect(bad).not.toContain("secondary source");
    expect(render(verified)).toContain("Varies by partner");
    expect(render(dated)).not.toContain("human should");
  });

  it("a listing with an unverified note reads 'Not published yet' where the deadline would be", () => {
    expect(card(unverified)).toContain("Not published yet");
    expect(listRow(unverified)).toContain("Not published yet");
    expect(text(factCardHtml("id-1", unverified))).toContain("Not published yet");
    expect(deadlineDisplay(unverified).text).toBe("Not published yet");
  });

  it("the meta description keeps the lead sentence and drops only the unverified note", () => {
    const d = scholarshipMetaDescription(unverified);
    expect(d).toMatch(/scholarship/i);
    expect(d).not.toContain("human");
  });
});

describe("the select lists carry the stamp the helper needs", () => {
  it("PUBLIC_COLUMNS (the detail page and the blog embed) selects deadline_verified_at", () => {
    expect(PUBLIC_COLUMNS).toMatch(/\bdeadline_verified_at\b/);
  });
  it("the landing preview columns select it too", () => {
    expect(readFileSync("src/lib/seo/landing-page-data.ts", "utf8")).toMatch(/LANDING_PREVIEW_COLUMNS =\s*"[^"]*\bdeadline_verified_at\b/);
  });
});

describe("ratchet: no file in src/ reads `.deadline_note` except through publicDeadlineNote", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  };
  // The admin edit page shows the STORED note to the operator who is editing it (never to the public, and behind the scholarships permission): it must see the raw value, stamp or no stamp.
  const ALLOWED = new Set(["src/lib/scholarships/public-deadline-note.ts", "src/app/admin/(protected)/scholarships/[id]/edit/page.tsx"]);

  it("finds nothing else (the scan reads the real source tree, so it is not vacuous)", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.filter((f) => !ALLOWED.has(f.split("\\").join("/")) && /\.deadline_note\b/.test(readFileSync(f, "utf8")));
    expect(offenders, "read a deadline note through publicDeadlineNote()/deadlineNoteOrFallback(), never directly").toEqual([]);
  });

  it("the detail page uses the helpers for both its body and its meta description", () => {
    const page = readFileSync("src/app/(app)/scholarships/[id]/page.tsx", "utf8");
    expect(page).toMatch(/deadlineNoteOrFallback\(/);
    expect(page).toMatch(/scholarshipMetaDescription\(/);
  });
});
