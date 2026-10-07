/**
 * NAV-1 (owner request): the seeker menu item that leads to /talent-directory/verify is called "Talent Directory", not "Resume review", and the page opens by
 * explaining that a listing starts with a resume review. The URL does not change. Read from source because the masthead's link list is a module constant and the
 * page needs a signed-in session to render; the browser half is e2e/masthead-nav-fit.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

describe("NAV-1: the seeker masthead item", () => {
  const masthead = read("src/components/app-shell/masthead.tsx");
  it("labels /talent-directory/verify 'Talent Directory' and keeps the URL", () => {
    expect(masthead).toContain('{ href: "/talent-directory/verify", label: "Talent Directory" }');
  });
  it("no longer calls it 'Resume review'", () => {
    expect(masthead).not.toContain('label: "Resume review"');
  });
});

describe("NAV-1: the page leads with the Talent Directory", () => {
  const page = read("src/app/(app)/talent-directory/verify/page.tsx");
  const loading = read("src/app/(app)/talent-directory/verify/loading.tsx");
  it("the tab title is Talent Directory", () => {
    expect(page).toContain('title: "Talent Directory — Talentrah"');
  });
  it("the heading is 'Join the Talent Directory' on the page and its loading skeleton", () => {
    expect(page).toContain(">Join the Talent Directory</h1>");
    expect(loading).toContain(">Join the Talent Directory</h1>");
    expect(page).not.toContain("Get your resume reviewed");
    expect(loading).not.toContain("Get your resume reviewed");
  });
  it("the eyebrow says what is below it (how to get listed), not the heading's words again", () => {
    expect(page).toContain("<EyebrowLabel>How to get listed</EyebrowLabel>");
    expect(loading).toContain("<EyebrowLabel>How to get listed</EyebrowLabel>");
  });
  it("the intro says the resume review is the step that gets you listed", () => {
    expect(page).toContain("Employers browse the Talent Directory");
    expect(page).toContain("review is the step that gets you listed");
  });
});
