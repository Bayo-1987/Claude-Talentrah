/**
 * send-377 — AdminScholarshipForm's "Other eligibility notes" field, plain
 * `<textarea>` replaced with `MinimalRichEditor`. Same static-markup
 * technique and same limitation as tests/admin/decision-form-rich-note.test.tsx
 * and tests/talent-directory/decide-form-rich-note.test.tsx (send-372):
 * TipTap's useEditor() returns null server-side, so this proves the OLD
 * markup is gone rather than asserting on the new editor's own DOM.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminScholarshipForm } from "@/app/admin/(protected)/scholarships/new/admin-scholarship-form";

describe("AdminScholarshipForm's eligibilityOther field", () => {
  it("no longer renders the plain <textarea name=\"eligibilityOther\">", () => {
    const html = renderToStaticMarkup(<AdminScholarshipForm />);
    expect(html).not.toContain('<textarea id="eligibilityOther" name="eligibilityOther"');
  });

  it("reviewNote (internal-only, out of this ticket's scope) keeps its plain <textarea> unchanged", () => {
    const html = renderToStaticMarkup(<AdminScholarshipForm />);
    expect(html).toContain('<textarea id="reviewNote" name="reviewNote"');
  });
});
