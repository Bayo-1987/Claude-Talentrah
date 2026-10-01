/**
 * send-495 / S19 — the Start-from-a-template screen said "Import my CV" and "a complete, realistic CV". The house
 * rule is "Resume" (the site-wide ratchet is tests/copy/no-cv-in-user-facing-strings.test.ts); this pins the two
 * replacement strings so a rewording is deliberate.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/resume-builder/actions", () => ({ createResumeAction: async () => {} }));
vi.mock("@/components/onboarding/resume-upload", () => ({ ResumeUpload: () => null }));

import { StartStateChooser } from "@/components/resume-builder/start-state-chooser";

const html = renderToStaticMarkup(<StartStateChooser templateId="clean-professional" templateName="Clean Professional" hasBaseResume />)
  .replace(/&#x27;/g, "'");

describe("StartStateChooser copy", () => {
  it("offers 'Import my resume', not 'Import my CV'", () => {
    expect(html).toContain("Import my resume");
    expect(html).not.toMatch(/Import my CV/);
  });

  it("describes the sample as a 'complete, realistic resume'", () => {
    expect(html).toContain("Open a complete, realistic resume in this template");
  });

  it("says CV nowhere on the screen", () => {
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\bCVs?\b/);
  });
});
