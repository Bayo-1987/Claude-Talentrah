/**
 * "Apply by email" (PR-E1): what the feed card and the job page show for each combination of company link and stored address.
 *
 *   link only      exactly what main showed (tests/jobs/apply-control-baseline.test.tsx holds the bytes)
 *   address only   "Apply by email" (a mailto link), and on the page the address, a copy button and the note; "Mark as applied" stays
 *   both           the company link stays the primary button, the address is the secondary choice
 *   neither        no apply control at all: no dead "#" anchor, no data-ad-click (the one intended change; "Mark as applied" is the seeker's own record and stays)
 *
 * The card is rendered whole. The job page is a 750-line async Server Component that no unit test can render, so it is checked two ways: the pieces it renders
 * (ApplyByEmailLink / ApplyByEmailNote, variant "page") are rendered here, and its wiring is read from source. Every address below is invented.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { ApplyByEmailLink, ApplyByEmailNote, CARD_PRIMARY_LINK_CLASS, CARD_SECONDARY_LINK_CLASS } from "@/components/jobs/apply-by-email";
import type { Tables } from "@/lib/supabase/types";

const FEED = "11111111-1111-4111-8111-111111111111";
const MAIL = "mailto:careers@example.test?subject=Application%3A%20Support%20Lead";

function card(over: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const job = { id: "job-1", title: "Support Lead", company_name: "Acme", description: "A real posting.", location: "Lagos", work_type: null, seniority: null, external_url: "https://careers.acme.test/1", status: "open", source_type: "external", posted_at: "2026-11-01T00:00:00.000Z", last_checked_at: null, import_feed_id: null, ...over };
  return renderToStaticMarkup(
    <JobCard
      job={job as unknown as Tables<"job_postings">}
      score={75}
      isSaved={false}
      applicationStage={null}
      explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
      applicantCount={null}
      {...extra}
    />,
  );
}

const anchors = (html: string) => [...html.matchAll(/<a [^>]*>[^<]*<\/a>/g)].map((m) => m[0]);
const applyAnchors = (html: string) => anchors(html).filter((a) => /Apply on company site|Apply by email|Or apply by email/.test(a));
const classOf = (a: string) => /class="([^"]*)"/.exec(a)?.[1];

describe("the feed card", () => {
  it("link only: the company-site anchor and nothing about e-mail", () => {
    const html = card({});
    expect(applyAnchors(html)).toHaveLength(1);
    expect(html).toContain("Apply on company site");
    expect(html).not.toMatch(/mailto:|Apply by email|data-ad-click/);
  });

  it("address only: one 'Apply by email' mailto anchor, same size and class as the company-site anchor, plus 'Mark as applied'", () => {
    const linkOnly = applyAnchors(card({}))[0];
    const html = card({ external_url: null, apply_email: "careers@example.test" });
    const found = applyAnchors(html);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`href="${MAIL}"`);
    expect(found[0]).toContain(">Apply by email</a>");
    expect(classOf(found[0])).toBe(classOf(linkOnly));
    expect(classOf(found[0])).toBe(CARD_PRIMARY_LINK_CLASS);
    expect(html).toContain("Mark as applied");
    expect(html).not.toContain("Apply on company site");
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain("target="); // a mailto link opens the mail app; a new tab would be a blank one
  });

  it("both: the company link first and primary, the address second and secondary", () => {
    const html = card({ apply_email: "careers@example.test" });
    const found = applyAnchors(html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('href="https://careers.acme.test/1"');
    expect(found[0]).toContain(">Apply on company site</a>");
    expect(found[1]).toContain(`href="${MAIL}"`);
    expect(found[1]).toContain(">Or apply by email</a>");
    expect(classOf(found[1])).toBe(CARD_SECONDARY_LINK_CLASS);
    expect(classOf(found[0])).toBe(CARD_PRIMARY_LINK_CLASS);
  });

  it("neither: no apply control at all (no anchor, no '#', no data-ad-click), and the seeker's own 'Mark as applied' stays", () => {
    for (const html of [card({ external_url: null }), card({ external_url: null, apply_email: null }), card({ external_url: null }, { isSponsored: true, campaignId: "c-1" })]) {
      expect(applyAnchors(html)).toEqual([]);
      expect(html).not.toContain('href="#"');
      // The title link of a sponsored card carries data-ad-click on main too; no APPLY anchor may.
      const tracked = [...html.matchAll(/<a [^>]*data-ad-click[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
      expect(tracked.filter((text) => text !== "Support Lead")).toEqual([]);
      expect(html).not.toMatch(/mailto:|Apply on company site|Apply by email/);
      expect(html).toContain("Mark as applied");
    }
  });

  it("a missing apply_email (a row from a path that does not select it) is treated as no address", () => {
    const withoutField = card({ external_url: null });
    const withNull = card({ external_url: null, apply_email: null });
    expect(withoutField).toBe(withNull);
    expect(card({})).toBe(card({ apply_email: null }));
  });

  it("an address stored with spaces and capitals renders normalised, never raw", () => {
    const html = card({ external_url: null, apply_email: "  Careers@Example.TEST  " });
    expect(html).toContain(`href="${MAIL}"`);
    expect(html).not.toContain("Careers@Example.TEST");
    expect(html).not.toMatch(/mailto:\s|mailto:%20|mailto:[^"]*[A-Z]@/);
  });

  it.each(["a@b.co?cc=x", "a@b.co%0ABcc:x", "a@b.co,c@d.co", "<a@b.co>", "not an address", "a@b", ".a@b.co", "a..b@c.co", "a@b.co\nBcc:x"])("an invalid stored value (%j) renders nothing, not even the raw text", (bad) => {
    const html = card({ external_url: null, apply_email: bad });
    expect(applyAnchors(html)).toEqual([]);
    expect(html).not.toMatch(/mailto:|Apply by email/);
    expect(html).not.toContain(bad.trim());
  });

  it("an invalid address next to a company link leaves the company link as the only choice", () => {
    const html = card({ apply_email: "a@b.co?cc=x" });
    expect(applyAnchors(html)).toHaveLength(1);
    expect(html).not.toContain("mailto:");
  });

  it("a sponsored card: the mailto anchor carries data-ad-click like the company-site anchor does; a card that is not sponsored has none", () => {
    const sponsored = card({ external_url: null, apply_email: "careers@example.test" }, { isSponsored: true, campaignId: "c-1" });
    expect(applyAnchors(sponsored)[0]).toContain('data-ad-click="true"');
    const secondary = card({ apply_email: "careers@example.test" }, { isSponsored: true, campaignId: "c-1" });
    expect(applyAnchors(secondary).every((a) => a.includes('data-ad-click="true"'))).toBe(true);
    expect(card({ external_url: null, apply_email: "careers@example.test" })).not.toContain("data-ad-click");
  });

  it("an imported posting (internal row, import_feed_id set) with only an address gets the same 'Apply by email'", () => {
    const html = card({ source_type: "internal", import_feed_id: FEED, external_url: null, apply_email: "careers@example.test" });
    expect(applyAnchors(html)[0]).toContain(`href="${MAIL}"`);
  });

  it("an internal posting that has a stored address takes applications by email (PR-E2b reverses the E1 rule that ignored it); one without an address is the ordinary in-app Apply, unchanged", () => {
    const html = card({ source_type: "internal", apply_email: "careers@example.test", external_url: null });
    expect(html).toContain(">Apply by email</a>");
    expect(html).toContain("mailto:careers@example.test");
    expect(html).not.toMatch(/type="submit">Apply<\/button>|Apply on company site/);
    const plain = card({ source_type: "internal", external_url: null });
    expect(plain).toMatch(/type="submit">Apply<\/button>/);
    expect(plain).not.toMatch(/mailto:|Apply by email|Apply on company site/);
  });

  it("the subject carries the job title, encoded", () => {
    const html = card({ external_url: null, apply_email: "careers@example.test", title: "R&D Lead #2 (100% remote)?" });
    expect(html).toContain("subject=Application%3A%20R%26D%20Lead%20%232%20(100%25%20remote)%3F");
  });
});

describe("the job page's pieces (variant 'page')", () => {
  const link = (secondary: boolean) => renderToStaticMarkup(<ApplyByEmailLink address="careers@example.test" title="Support Lead" variant="page" secondary={secondary} />);

  it("address only: a primary 'Apply by email' button, then the Copy address button", () => {
    const html = link(false);
    expect(html).toContain(`href="${MAIL}"`);
    expect(html).toMatch(/>Apply by email<\/a>/);
    expect(html).toContain("bg-ink text-paper"); // the same primary button the company link uses (buttonClasses primary)
    expect(html.indexOf("Apply by email")).toBeLessThan(html.indexOf("Copy address"));
  });

  it("with a company link too: the address is the secondary (bordered) choice, 'Or apply by email'", () => {
    const html = link(true);
    expect(html).toMatch(/>Or apply by email<\/a>/);
    expect(html).toContain("border border-line");
    expect(html).not.toContain("bg-ink text-paper");
  });

  it("the copy button: a real button with a 40px hit target, an inline SVG, no rounded corners, and no emoji", () => {
    const html = link(false);
    const button = /<button[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toMatch(/min-h-\[40px\]/);
    expect(button).toContain("<svg");
    expect(button).toContain('aria-hidden="true"');
    expect(button).toContain("Copy address");
    expect(button).toContain("rounded-none");
    expect(button).not.toMatch(/rounded-(?!none)/);
    expect(button).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("the component re-checks the address it is given: a value that is not one plain address renders nothing", () => {
    for (const bad of ["a@b.co?cc=x", "a@b.co%0ABcc:x", "a@b", ""]) {
      for (const variant of ["page", "card"] as const) {
        expect(renderToStaticMarkup(<ApplyByEmailLink address={bad} title="Support Lead" variant={variant} />), `${variant} ${JSON.stringify(bad)}`).toBe("");
      }
    }
  });

  it("the note does NOT print the address (it points at the button and Copy address) and says what Talentrah does not do", () => {
    const html = renderToStaticMarkup(<ApplyByEmailNote {...({ address: "careers@example.test" } as object)} />);
    expect(html).not.toContain("careers@example.test");
    expect(html).not.toContain("example.test");
    expect(html).toContain("Apply by email");
    expect(html).toContain("Copy address");
    expect(html).toContain("Talentrah does not send this email or attach your resume.");
    expect(html).not.toMatch(/rounded-/);
    expect(html).not.toMatch(/\bCVs?\b/); // the house word is "resume" (tests/copy/no-cv-in-user-facing-strings.test.ts)
  });
});

describe("the job page's wiring (source)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");
  const branchStart = src.indexOf(") : isExternal ? (");
  const branch = src.slice(branchStart, src.indexOf(") : !hasBaseResume ? (", branchStart));

  it("the address is read through the helper, and only for a link-out posting", () => {
    expect(src).toContain("const applyEmail = isExternal ? normaliseApplyEmail(job.apply_email) : null;");
  });
  it("the company link renders only when there is one: no '#' fallback anywhere", () => {
    expect(branch).toContain('{job.external_url && ( <a href={job.external_url} target="_blank"');
    expect(src).not.toContain('?? "#"');
  });
  it("the address block is the secondary choice exactly when a company link exists", () => {
    expect(branch).toContain('{applyEmail && <ApplyByEmailLink address={applyEmail} title={job.title} variant="page" secondary={!!job.external_url} />}');
    expect(branch).toContain("{applyEmail && <ApplyByEmailNote />}");
  });
  it("'Mark as applied' is present for every link-out posting, an address-only one included (it sits outside both conditions)", () => {
    const form = branch.indexOf("<form action={markAppliedExternallyAction.bind(null, job.id, detailCountryState)}>");
    expect(form).toBeGreaterThan(branch.indexOf("{applyEmail && <ApplyByEmailLink"));
    expect(form).toBeLessThan(branch.indexOf("{applyEmail && <ApplyByEmailNote"));
    expect(branch).toContain("Mark as applied");
  });
  it("the signed-out view is unchanged: no address, still 'View on company site' only for a posting with a link", () => {
    const signedOut = src.slice(src.indexOf("{!user ? ("), branchStart);
    expect(signedOut).not.toMatch(/applyEmail|ApplyByEmail|apply_email|mailto/);
    expect(signedOut).toContain("{isExternal && job.external_url && ( <a href={job.external_url}");
  });
  it("the feed card has no '#' fallback either", () => {
    const cardSrc = readFileSync(path.join(process.cwd(), "src/components/jobs/job-card.tsx"), "utf8");
    expect(cardSrc).not.toContain('?? "#"');
  });
});
