/**
 * EMP-1 / E4 — post-a-job layout.
 *
 *  1. The assessment exercise-files upload belongs UNDER the "Attach an
 *     assessment" checkbox and is visible only while it is ticked. It used to be
 *     a separate card above (create) / below (edit) the form, visible whether or
 *     not an assessment was being attached.
 *  2. The "Let Farah scope this job" button carries Farah's SVG mark, not a "✦"
 *     text glyph, and keeps an accessible name of exactly its words.
 *
 * Server-rendered (react-dom/server): the INITIAL visibility is a pure function
 * of the props (`enabled = !!initial`). The click-through (tick / untick /
 * re-tick) is covered in a real browser by e2e/post-job-form-layout.spec.ts.
 *
 * What unticking does (decided, and pinned here and in the e2e):
 *   - Create: the staged-files picker stays MOUNTED but hidden, so unticking
 *     and re-ticking keeps what was picked; nothing is deleted. On submit with
 *     the box unticked the staged files are discarded with the draft (no
 *     assessment is saved to attach them to), exactly as before.
 *   - Edit: files already uploaded to a saved assessment are untouched by
 *     unticking (they live on the server). Unticking only hides the section;
 *     they are removed only if the employer then SAVES with the box unticked,
 *     which removes the assessment itself — the same as before this change.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/employer/pending-job-assessment-files", () => ({
  CREATE_SCOPE: "create",
  clearIfNothingStagedThisSession: () => {},
  writePendingAssessmentFiles: async () => {},
}));

import { AssessmentEditor } from "@/components/employer/assessment-editor";
import { FarahScopeButton } from "@/components/employer/farah-scope-button";

const SAVED = {
  title: "Take-home SQL",
  instructions: "Write three queries.",
  exerciseLink: null,
  required: true,
};

const FILES = [
  { id: "f1", url: "https://example.test/brief.pdf", originalFilename: "brief.pdf", byteSize: 2048 },
  { id: "f2", url: null, originalFilename: "data.txt", byteSize: 10 },
];

/** The files section element's opening tag, or null when it is not in the DOM at all. */
function filesSectionTag(html: string): string | null {
  return /<[a-z]+[^>]*id="assessment-exercise-files"[^>]*>/.exec(html)?.[0] ?? null;
}

function isHidden(tag: string | null): boolean {
  return !!tag && /\shidden(=|\s|>)/.test(tag);
}

describe("assessment exercise files — create (staging picker)", () => {
  const create = { userId: "u1" };

  it("is hidden while 'Attach an assessment' is unticked", () => {
    const html = renderToStaticMarkup(<AssessmentEditor initial={null} createContext={create} />);
    const tag = filesSectionTag(html);
    expect(tag).not.toBeNull();
    expect(isHidden(tag)).toBe(true);
  });

  it("is visible when the assessment is on", () => {
    const html = renderToStaticMarkup(<AssessmentEditor initial={SAVED} createContext={create} />);
    const tag = filesSectionTag(html);
    expect(tag).not.toBeNull();
    expect(isHidden(tag)).toBe(false);
    expect(html).toContain("Assessment exercise files");
  });

  it("sits INSIDE the assessment's own box, after the checkbox", () => {
    const html = renderToStaticMarkup(<AssessmentEditor initial={null} createContext={create} />);
    expect(html.indexOf("Attach an assessment (optional)")).toBeGreaterThan(-1);
    expect(html.indexOf("Attach an assessment (optional)")).toBeLessThan(html.indexOf("assessment-exercise-files"));
  });

  it("renders no files section when there is no create context (edit of a job with no assessment yet)", () => {
    const html = renderToStaticMarkup(
      <AssessmentEditor initial={null} editContext={{ jobId: "j1", userId: "u1" }} />,
    );
    expect(filesSectionTag(html)).toBeNull();
  });
});

describe("assessment exercise files — edit (saved assessment)", () => {
  const edit = { jobId: "j1", userId: "u1" };

  it("shows the saved files under the checkbox when the assessment is ticked", () => {
    const html = renderToStaticMarkup(
      <AssessmentEditor initial={SAVED} editContext={edit} savedFiles={FILES} />,
    );
    const tag = filesSectionTag(html);
    expect(tag).not.toBeNull();
    expect(isHidden(tag)).toBe(false);
    expect(html).toContain("brief.pdf");
    expect(html).toContain("data.txt");
    expect(html).toContain("Assessment exercise files");
  });

  it("the saved-file list is not a second card: one 'Assessment exercise files' heading", () => {
    const html = renderToStaticMarkup(
      <AssessmentEditor initial={SAVED} editContext={edit} savedFiles={FILES} />,
    );
    expect(html.match(/Assessment exercise files/g)?.length).toBe(1);
  });
});

describe("the Farah scope button", () => {
  const render = (props: { disabled?: boolean; drafting?: boolean } = {}) =>
    renderToStaticMarkup(
      <FarahScopeButton disabled={props.disabled ?? false} drafting={props.drafting ?? false} onClick={() => {}} />,
    );

  it("renders Farah's SVG mark and no text glyph", () => {
    const html = render();
    expect(html).toContain("<svg");
    // The mark: two overlapping stroked circles.
    expect(html.match(/<circle/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("✦");
  });

  it("the mark is decorative: aria-hidden, so the name is only the words", () => {
    const html = render();
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    const name = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
    expect(name).toBe("Let Farah scope this job");
  });

  it("is a button of type=button (it must not submit the job form)", () => {
    expect(render()).toMatch(/<button[^>]*type="button"/);
  });

  it("says what it is doing while drafting, and disables itself", () => {
    const html = render({ drafting: true, disabled: true });
    expect(html).toContain("Farah is scoping this job…");
    expect(html).toMatch(/<button[^>]*\sdisabled/);
  });
});

describe("no text glyphs as icons in the employer components", () => {
  it("has no ✦ (or similar star/sparkle glyph) in src/components/employer", () => {
    const dir = path.join(process.cwd(), "src/components/employer");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!/\.tsx?$/.test(f)) continue;
      const text = readFileSync(path.join(dir, f), "utf8");
      // Only string/JSX literals matter, but a glyph in a comment is also a smell worth a look.
      if (/[✦✧★☆✨]/u.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
