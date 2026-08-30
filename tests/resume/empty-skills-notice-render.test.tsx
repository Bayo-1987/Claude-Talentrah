/**
 * What the empty-skills notice is allowed to be (#145).
 *
 * The predicate deciding WHETHER it shows is tested in
 * empty-skills-notice.test.ts. This pins what it says and, more importantly,
 * what it must never become.
 *
 * CLAUDE.md forbids a profile-completion bar or gamification meter anywhere in
 * the product — a hard rule tied to the anti-gamification retention stance,
 * not a style preference. A notice about an incomplete profile is exactly the
 * thing that drifts into one: someone adds "your profile is 40% complete" or a
 * "1 of 3 steps" counter because it feels helpful, and the rule is broken by a
 * well-meant edit rather than a decision. So the absence is asserted.
 *
 * It also has to be ACTIONABLE. The failure this replaces was a user being
 * told something true and transient that they could not act on later, so a
 * version of this that states the problem without offering the fix would
 * reproduce the original defect in a new place.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptySkillsNotice } from "@/components/resume-builder/empty-skills-notice";

const RESUME_ID = "11111111-1111-1111-1111-111111111111";
const html = renderToStaticMarkup(<EmptySkillsNotice baseResumeId={RESUME_ID} />);

describe("it points at the fix, not just the problem", () => {
  it("links to editing this specific resume", () => {
    expect(html).toContain(`/resume-builder/edit?resumeId=${RESUME_ID}`);
    expect(html).toContain("Add your skills");
  });

  it("offers re-uploading, because the original file is gone", () => {
    // There is no stored file to reprocess — resumes keeps only the parsed
    // output — so re-uploading is genuinely the other half of the remedy.
    expect(html).toContain("/onboarding");
  });

  it("says why it matters in terms of matching, not in terms of completeness", () => {
    expect(html).toMatch(/scor|match/i);
  });

  it("can be dismissed", () => {
    expect(html).toContain("<button");
  });
});

describe("it is not a completion meter", () => {
  it("shows no percentage", () => {
    expect(html).not.toMatch(/\d+\s*%/);
  });

  it("shows no step or progress counter", () => {
    // "1 of 3", "step 2", "2 remaining" — the shapes a completion prompt takes
    // when it arrives one helpful edit at a time.
    expect(html).not.toMatch(/\b\d+\s+of\s+\d+\b/i);
    expect(html).not.toMatch(/\bstep\s*\d/i);
    expect(html).not.toMatch(/\bremaining\b/i);
    expect(html).not.toMatch(/\bcomplete(d|ness)?\b/i);
  });

  it("uses no progress element or meter", () => {
    expect(html).not.toContain("<progress");
    expect(html).not.toContain("<meter");
    expect(html).not.toMatch(/role="progressbar"/);
  });
});

describe("it is in the design system's language", () => {
  it("is a square-cornered bordered box with no shadow", () => {
    // Editorial: no border-radius anywhere except small circular affordances,
    // and the hero input is the only shadow in the product.
    expect(html).toContain("border-[1.5px]");
    expect(html).toContain("border-ink");
    expect(html).not.toMatch(/rounded/);
    expect(html).not.toMatch(/shadow/);
  });
});
