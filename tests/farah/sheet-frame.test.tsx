/**
 * The Farah sheet's frame (src/components/app-shell/farah-sheet-frame.tsx): the ALREADY-MOUNTED panel, shown as a bottom sheet on phones.
 *
 * The central claim is that the panel is never conditionally rendered: app-shell.tsx explains that unmounting it throws the conversation away. So the closed sheet must still contain its children.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FarahSheetFrame } from "@/components/app-shell/farah-sheet-frame";

const render = (open: boolean) =>
  renderToStaticMarkup(
    <FarahSheetFrame open={open}>
      <p data-testid="farah-panel">the panel</p>
    </FarahSheetFrame>,
  );

describe("the closed sheet", () => {
  const html = render(false);

  it("still contains the panel (it is re-presented, never unmounted)", () => {
    expect(html).toContain('data-testid="farah-panel"');
    expect(html).toContain("the panel");
  });

  it("is invisible below 760px (so it is out of the tab order and hidden from assistive technology) and has no dialog role", () => {
    expect(html).toContain('data-sheet="closed"');
    expect(html).toMatch(/data-\[sheet=closed\]:max-\[760px\]:invisible/);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
  });

  it("has no scrim and no aria-hidden (aria-hidden would also hide the docked panel from a desktop screen reader)", () => {
    expect(html).not.toContain("farah-sheet-scrim");
    expect(html).not.toMatch(/<div[^>]*id="farah-sheet"[^>]*aria-hidden/);
  });
});

describe("the open sheet", () => {
  const html = render(true);

  it("is a modal dialog with a name", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Farah, AI assistant"');
    expect(html).toContain('data-sheet="open"');
    expect(html).toContain('id="farah-sheet"');
  });

  it("keeps the panel inside it", () => {
    expect(html).toContain('data-testid="farah-panel"');
  });

  it("has a Close button with a name and a real target, visible below 760px only", () => {
    expect(html).toMatch(/<button[^>]*aria-label="Close Farah"/);
    expect(html).toContain("min-h-11");
    expect(html).toMatch(/Close Farah"[^>]*class="[^"]*min-\[760px\]:hidden|min-\[760px\]:hidden[^"]*"[^>]*aria-label="Close Farah"/);
  });

  it("has a scrim behind it, below 760px only, that is not announced", () => {
    expect(html).toContain('data-testid="farah-sheet-scrim"');
    expect(html).toMatch(/data-testid="farah-sheet-scrim"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-testid="farah-sheet-scrim"/);
  });

  it("is about 85% of the viewport at most (dvh, so the browser toolbar does not push it off), with square corners and the paper-alt field", () => {
    expect(html).toContain("max-[760px]:max-h-[85dvh]");
    expect(html).toContain("bg-paper-alt");
    expect(html).not.toMatch(/rounded/);
  });

  it("scrolls inside itself without chaining the scroll to the page behind it", () => {
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("overflow-y-auto");
  });

  it("slides only if motion is allowed: the transition is a motion-safe rule, not a base rule with a motion-reduce override (the override LOST to the phone-only rule in the browser)", () => {
    expect(html).toContain("max-[760px]:motion-safe:transition-transform");
    expect(html).not.toMatch(/(?<!motion-safe:)transition-transform/);
  });
});

describe("what does not change from 760px up", () => {
  const html = render(false);
  it("the docked panel's hairline, tint and print rule are kept on the same element", () => {
    expect(html).toContain("min-[760px]:border-l");
    expect(html).toContain("min-[760px]:border-l-line");
    expect(html).toContain("print:hidden");
  });
  it("every phone-only rule is a max-[760px] rule, so none can reach 760", () => {
    const classes = /id="farah-sheet"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*id="farah-sheet"/.exec(html);
    const list = (classes?.[1] ?? classes?.[2] ?? "").split(/\s+/);
    for (const c of list.filter((c) => /^(fixed|inset-x-0|bottom-0|z-\[40\]|translate-y-full)$/.test(c))) {
      throw new Error(`unprefixed phone-only class "${c}" would apply at 760px and up`);
    }
  });
});
