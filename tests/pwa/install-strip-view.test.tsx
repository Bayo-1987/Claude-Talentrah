/**
 * The install strip's markup (src/components/pwa/install-strip-view.tsx): honest copy, Editorial rules, real hit targets.
 * Behaviour in a browser is e2e/pwa-install-strip.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InstallStripView } from "@/components/pwa/install-strip-view";

const noop = () => undefined;
const android = renderToStaticMarkup(<InstallStripView kind="prompt" onInstall={noop} onDismiss={noop} />);
const ios = renderToStaticMarkup(<InstallStripView kind="ios" onInstall={noop} onDismiss={noop} />);

describe("the Android/Chromium strip", () => {
  it("offers a real Install button and a Not now button", () => {
    expect(android).toMatch(/<button[^>]*>Install<\/button>/);
    expect(android).toMatch(/<button[^>]*>Not now<\/button>/);
  });
  it("is labelled for assistive tech and tagged for tests", () => {
    expect(android).toContain('data-testid="install-strip"');
    expect(android).toMatch(/aria-label="Install Talentrah"/);
  });
});

describe("the iOS strip", () => {
  it("says exactly how to install, and offers no Install button (iOS has no install prompt)", () => {
    expect(ios).toContain("To install: tap Share, then Add to Home Screen.");
    expect(ios).not.toMatch(/>Install</);
    expect(ios).toMatch(/<button[^>]*>Not now<\/button>/);
  });
});

describe.each([["Android", android], ["iOS", ios]])("%s strip: Editorial and accessible", (_n, html) => {
  it("has hit targets of at least 40 by 40 on every button", () => {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b, b).toMatch(/min-h-\[(4[0-9]|[5-9][0-9])px\]/);
      expect(b, b).toMatch(/min-w-\[(4[0-9]|[5-9][0-9])px\]/);
    }
  });
  it("has no rounded corners, no shadow, no emoji, no countdown or badge", () => {
    expect(html).not.toMatch(/rounded(?!-none)|shadow/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).not.toMatch(/badge|countdown|%|\bdays?\b|expires/i);
  });
  it("is hidden when printing", () => {
    expect(html).toContain("print:hidden");
  });
});
