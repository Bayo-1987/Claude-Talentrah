/**
 * The cookie banner no longer shifts the page (S1-26 item 3, first part: the layout shift, and what the link says).
 *
 * THE SHIFT. The banner was an in-flow block at the top of <body> that only appeared after hydration, pushing every page below it down: CLS
 * 0.16 to 0.19 on /, /jobs and a job page (Lighthouse, mobile). It is now in the server-rendered HTML, so it is there at first paint. A returning visitor
 * (consent already stored) never sees it: a tiny inline script in <body>, ahead of the banner, sets data-cookie-consent on <html> before first paint, and
 * one CSS rule hides the banner on that attribute. No flash for a returning visitor, no shift for anyone.
 *
 * Everything here runs without a database or a browser (server render, the script run in a function, the layout and CSS read as text), so the CI
 * Playwright run in e2e/cookie-consent-banner.spec.ts and e2e/layout-shift.spec.ts is not the first time any of it executes.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; className?: string }) => <a href={p.href} className={p.className}>{p.children as never}</a> }));

const { CookieConsentBanner } = await import("@/components/legal/cookie-consent-banner");
const { COOKIE_CONSENT_PREPAINT_SCRIPT, COOKIE_CONSENT_STORAGE_KEY } = await import("@/components/legal/cookie-consent-script");
const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");

describe("the banner is part of the server-rendered page", () => {
  const html = renderToStaticMarkup(<CookieConsentBanner />);

  it("renders at first paint, so it cannot shift the page when it appears", () => {
    expect(html).toContain('data-testid="cookie-consent-banner"');
    expect(html).toContain("Decline");
    expect(html).toContain("Accept");
  });

  it("is a labelled region", () => {
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Cookie notice"');
  });

  it("names its link for what it opens, and still points at the Data & Cookie Notice", () => {
    expect(html).toContain(">Learn more about cookies</a>");
    expect(html).toContain('href="/legal/data-cookie-notice"');
    expect(html).not.toMatch(/>Learn more<\/a>/);
  });

  it("the component starts visible, not hidden (the old state started false and showed after mount)", () => {
    expect(read("src/components/legal/cookie-consent-banner.tsx")).toMatch(/useState\(true\)/);
    expect(read("src/components/legal/cookie-consent-banner.tsx")).not.toMatch(/useState\(false\)/);
  });
});

describe("returning visitors never see it, with no flash", () => {
  const run = (stored: string | null | "throws") => {
    const attrs: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
    const storage = { getItem: (k: string) => { if (stored === "throws") throw new Error("blocked"); return k === COOKIE_CONSENT_STORAGE_KEY ? stored : null; } };
    new Function("document", "localStorage", COOKIE_CONSENT_PREPAINT_SCRIPT)(doc, storage);
    return attrs;
  };

  it("marks the page as decided when consent is stored (either choice)", () => {
    expect(run("accepted")).toEqual({ "data-cookie-consent": "decided" });
    expect(run("rejected")).toEqual({ "data-cookie-consent": "decided" });
  });

  it("leaves a first visit alone, ignores any other stored value, and never throws when storage is blocked", () => {
    expect(run(null)).toEqual({});
    expect(run("something-else")).toEqual({});
    expect(() => run("throws")).not.toThrow();
    expect(run("throws")).toEqual({});
  });

  it("reads the same storage key the banner writes (one constant, not two copies)", () => {
    expect(COOKIE_CONSENT_STORAGE_KEY).toBe("talentrah-cookie-consent");
    const banner = read("src/components/legal/cookie-consent-banner.tsx");
    expect(banner).toContain("COOKIE_CONSENT_STORAGE_KEY");
    expect(banner).not.toMatch(/"talentrah-cookie-consent"/);
  });

  it("the layout runs the script before the banner, and tolerates the attribute the script sets on <html>", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("COOKIE_CONSENT_PREPAINT_SCRIPT");
    expect(layout.indexOf("COOKIE_CONSENT_PREPAINT_SCRIPT")).toBeLessThan(layout.indexOf("<CookieConsentBanner"));
    expect(layout).toMatch(/<html[^>]*suppressHydrationWarning/);
  });

  it("one CSS rule hides the banner on that attribute", () => {
    expect(read("src/app/globals.css")).toMatch(/html\[data-cookie-consent="decided"\]\s+\[data-testid="cookie-consent-banner"\]\s*\{\s*display:\s*none/);
  });

  it("the script text has no template holes or quotes that would break it inside an inline <script>", () => {
    expect(COOKIE_CONSENT_PREPAINT_SCRIPT).not.toContain("</script");
    expect(COOKIE_CONSENT_PREPAINT_SCRIPT).not.toContain("${");
  });
});
