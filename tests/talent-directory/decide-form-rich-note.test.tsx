/**
 * send-372 — DecideForm's ("Notes for the candidate") plain `<textarea>`
 * replaced with `MinimalRichEditor`, same swap and same static-markup
 * technique as tests/admin/decision-form-rich-note.test.tsx (TipTap's
 * useEditor() returns null server-side, so this proves the OLD markup is
 * gone rather than asserting on the new editor's own DOM — see that file's
 * own comment for why a live check isn't needed a second time here).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecideForm } from "@/app/(app)/mentorship/reviews/[verificationId]/decide-form";

describe("DecideForm's candidate-notes field", () => {
  it("no longer renders the plain <textarea name=\"notes\">", () => {
    // MinimalRichEditor's own useEditor() returns null server-side (its own
    // header comment), so a static-markup render of it produces NEITHER the
    // old textarea NOR the new editor's markup yet — decision-form-rich-note
    // .test.tsx hits the exact same wall and asserts the same single thing
    // for the same reason. The `name="notes"` wiring itself is verified by
    // source inspection (MinimalRichEditor's hidden input uses `name={name}`;
    // decideVerificationReviewAction still reads formData.get("notes")
    // unchanged) rather than a redundant live DOM check — the same standard
    // decision-form-rich-note.test.tsx's own comment already sets, since
    // MinimalRichEditor's real browser behavior was proven once already
    // (send-370's resume summary field).
    const html = renderToStaticMarkup(
      <DecideForm verificationId="v1" candidateId="c1" />,
    );
    expect(html).not.toContain('<textarea id="notes" name="notes"');
    expect(html).not.toContain("<textarea");
  });
});
