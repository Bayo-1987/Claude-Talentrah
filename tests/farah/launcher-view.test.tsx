/**
 * The Farah launcher's markup (src/components/app-shell/farah-launcher-view.tsx): the round button on phones that replaces the bottom bar.
 *
 * Pure markup, rendered on the server: the unit environment has no DOM (vitest.config.ts), so these pin the attributes and classes that make it correct; where it sits at real widths is the
 * Playwright spec (e2e/farah-launcher.spec.ts).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FarahLauncherView } from "@/components/app-shell/farah-launcher-view";

const render = (props: Partial<React.ComponentProps<typeof FarahLauncherView>> = {}) =>
  renderToStaticMarkup(<FarahLauncherView expanded={false} concealed={false} open={false} {...props} />);

describe("the collapsed launcher", () => {
  const html = render();

  it("is one real button with the shell's test id", () => {
    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('type="button"');
    expect(html).toContain('data-testid="farah-launcher"');
  });

  it("is below 760px only, never printed, and fixed to the viewport", () => {
    expect(html).toContain("min-[760px]:hidden");
    expect(html).toContain("print:hidden");
    expect(html).toContain("fixed");
  });

  it("is a 56px circle (the one rounded shape the Reviewer approved, Q6) with a target of at least 44px", () => {
    expect(html).toContain("h-14");
    expect(html).toContain("w-14");
    expect(html).toContain("rounded-full");
  });

  it("keeps clear of the home indicator and of the install strip through the safe area and the strip's own height variable", () => {
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain("var(--farah-strip-h");
  });

  it("has an accessible name that contains every word it shows (WCAG 2.5.3): Ask Farah, AI assistant", () => {
    expect(html).toContain('aria-label="Ask Farah, AI assistant"');
    expect(html).toContain(">AI<");
  });

  it("says it opens a dialog and whether it is open, and what it controls", () => {
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="farah-sheet"');
    expect(render({ open: true })).toContain('aria-expanded="true"');
  });

  it("has exactly one position class: `fixed` (a `relative` beside it silently wins and leaves the button in the page flow; found by the browser spec)", () => {
    for (const html of [render(), render({ expanded: true })]) {
      const classes = /^<button[^>]*class="([^"]*)"/.exec(html)![1].split(/\s+/);
      expect(classes.filter((c) => /^(fixed|absolute|relative|sticky|static)$/.test(c))).toEqual(["fixed"]);
    }
  });

  it("has a visible keyboard focus ring and respects reduced motion", () => {
    expect(html).toContain("focus-visible:outline");
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("carries no shadow and no emoji", () => {
    expect(html).not.toMatch(/shadow/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the expanded pill (a first visit)", () => {
  const html = render({ expanded: true });

  it("shows the words 'Ask Farah · AI assistant' and takes its accessible name from them", () => {
    expect(html).toContain("Ask Farah");
    expect(html).toContain("AI assistant");
    expect(html).not.toContain("aria-label=");
  });

  it("is still a button of the same test id, still below 760px only", () => {
    expect(html).toContain('data-testid="farah-launcher"');
    expect(html).toContain("min-[760px]:hidden");
    expect(html).toContain('data-launcher="pill"');
    expect(render()).toContain('data-launcher="round"');
  });
});

describe("the launcher gets out of the way", () => {
  it("while the soft keyboard is open it is invisible and takes no taps", () => {
    const html = render({ concealed: true });
    expect(html).toContain("invisible");
    expect(html).toContain("pointer-events-none");
    expect(render()).not.toContain("invisible");
  });

  it("while the sheet is open it is inert (the page behind a modal dialog is not reachable)", () => {
    expect(render({ open: true })).toContain('inert=""');
    expect(render()).not.toContain("inert");
  });
});

describe("the unread dot still passes through", () => {
  // `bg-rust` appears only for FarahMark's dot: the launcher's own hover is `hover:bg-rust`, a different token.
  it("renders only when there is an unread notification", () => {
    expect(render()).not.toMatch(/(?<![:\w-])bg-rust/);
    expect(render({ hasUnreadNotification: true })).toMatch(/(?<![:\w-])bg-rust/);
  });
});
