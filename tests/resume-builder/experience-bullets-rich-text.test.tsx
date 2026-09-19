/**
 * send-370 Part B — resume experience bullets now use MinimalRichEditorList
 * (bold/italic paragraph-per-bullet), not the plain `<textarea>` this
 * replaces. Rendered with `renderToStaticMarkup`, the same technique
 * resume-editor-label-association.test.tsx already uses for this component.
 *
 * NOT testable via static markup: MinimalRichEditorList's own label/
 * toolbar/editable-div markup, because TipTap's `useEditor()` returns
 * `null` server-side (confirmed directly against this exact render — the
 * same reason `DecisionForm`'s `richNote={true}` branch can't be asserted
 * on this way either, see tests/admin/decision-form-rich-note.test.tsx's
 * own comment). What IS reachable and worth asserting on instead: the OLD
 * textarea's placeholder is genuinely gone, and — incidentally, since this
 * same render also produces the live preview panel fed by the same
 * `content` — the ACTUAL rendered bold/italic output for a bulleted entry,
 * which is real evidence the section-blocks.tsx `renderInlineMarkdown` wiring
 * works end to end, not just that the editor renders.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructuredResume } from "@/lib/resume/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { ResumeEditor } = await import("@/components/resume-builder/resume-editor");

const CONTENT: StructuredResume = {
  contact: { name: "Ada Bello", email: "ada@example.com" },
  summary: "",
  experience: [
    {
      title: "Backend Engineer",
      company: "Zaria Digital",
      location: "Lagos",
      startDate: "2022",
      endDate: "",
      description: "Old-format single-paragraph description, no bullets yet.",
    },
    {
      title: "Support Engineer",
      company: "Acme",
      location: "Abuja",
      startDate: "2020",
      endDate: "2022",
      description: "",
      bullets: ["Resolved **critical** tickets", "Mentored *two* juniors"],
    },
  ],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
};

const html = renderToStaticMarkup(
  <ResumeEditor resumeId="r1" initialTitle="My Resume" initialContent={CONTENT} templateSlug={null} />,
);

describe("experience bullets no longer use a plain <textarea>", () => {
  it("the old bullets textarea's placeholder text is gone (Projects/Certifications/etc. keep their own unrelated textareas)", () => {
    expect(html).not.toContain("One achievement per line");
  });

  it("still renders the Farah rewrite buttons unchanged, once per experience row", () => {
    const occurrences = html.split("More impact-driven").length - 1;
    expect(occurrences).toBe(2);
    expect(html).toContain("Quantify this");
    expect(html).toContain("More concise");
  });

  it(
    "REAL EVIDENCE the render side works end-to-end: the live preview panel (fed by the same content) shows " +
      "actual <strong>/<em> for a bulleted entry's markdown, and plain text for an old-format description",
    () => {
      expect(html).toContain("<li>Resolved <strong>critical</strong> tickets</li>");
      expect(html).toContain("<li>Mentored <em>two</em> juniors</li>");
      expect(html).toContain(">Old-format single-paragraph description, no bullets yet.<");
    },
  );
});
