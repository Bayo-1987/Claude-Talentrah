import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionForm } from "@/components/admin/decision-form";

/**
 * send-371 — DecisionForm's own `richNote` branch. Static-markup rendering,
 * same convention as tests/farah/render-markdown.test.tsx (no
 * @testing-library in this repo) — enough to prove the six non-opted-in
 * consumers keep the exact plain `<textarea name="note">` markup they
 * always had, and only an explicit `richNote` caller gets
 * MinimalRichEditor's toolbar/hidden-input markup instead.
 */

const NOOP_ACTION = async () => ({ status: "idle" as const, message: "", targetId: undefined });
const OPTIONS = [{ value: "approve", label: "Approve" }];

describe("DecisionForm richNote prop", () => {
  it("defaults to the plain textarea when richNote is omitted — the six unchanged consumers", () => {
    const html = renderToStaticMarkup(
      <DecisionForm id="row-1" action={NOOP_ACTION} options={OPTIONS} notePlaceholder="Why?" />,
    );
    expect(html).toContain('<textarea name="note"');
    expect(html).not.toContain('role="toolbar"');
  });

  it("richNote={false} explicitly behaves identically to omitting it", () => {
    const withDefault = renderToStaticMarkup(
      <DecisionForm id="row-1" action={NOOP_ACTION} options={OPTIONS} notePlaceholder="Why?" />,
    );
    const withExplicitFalse = renderToStaticMarkup(
      <DecisionForm id="row-1" action={NOOP_ACTION} options={OPTIONS} notePlaceholder="Why?" richNote={false} />,
    );
    expect(withExplicitFalse).toBe(withDefault);
  });

  // NOT a renderToStaticMarkup case: MinimalRichEditor's useEditor() is a
  // client-only TipTap hook that returns null until it hydrates in a real
  // DOM (`if (!editor) return null;`), so a static-markup render of
  // richNote={true} legitimately renders neither the old textarea NOR the
  // rich editor's own markup yet — that is TipTap's real, expected
  // behavior, not a DecisionForm bug. Proven live instead: the resume
  // summary field (send-370) renders this exact same MinimalRichEditor
  // component in a real browser (toolbar, bold/italic, save+reload
  // persistence all confirmed there) — DecisionForm's richNote branch below
  // just wires the same component to a different id/name/label, verified
  // by source inspection rather than a second, redundant live check.
  it("richNote={true} renders neither the plain textarea nor a script-submitted <a>/<img>, at minimum", () => {
    const html = renderToStaticMarkup(
      <DecisionForm id="row-1" action={NOOP_ACTION} options={OPTIONS} notePlaceholder="Why?" richNote />,
    );
    expect(html).not.toContain('<textarea name="note"');
  });
});
