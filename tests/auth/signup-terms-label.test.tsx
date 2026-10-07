/**
 * The signup terms checkbox (S1-26 item 3): the whole LABEL is the click target, at least 44px tall (the box itself stays 16px: a bigger box is not
 * a bigger target), and "Privacy Policy." keeps its full stop with the link (at 360px the sentence broke as "...Privacy Policy" + a stranded ".").
 *
 * Runs without a database or a browser (server render). The same two promises are measured in a real browser by e2e/signup-terms-label.spec.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/actions", () => ({ signUpAction: vi.fn(), signInWithOAuthAction: vi.fn() }));
const { SignupForm } = await import("@/components/auth/signup-form");

describe("the terms label", () => {
  const html = renderToStaticMarkup(<SignupForm />);
  const label = /<label[^>]*>(?:(?!<\/label>)[\s\S])*type="checkbox"[\s\S]*?<\/label>/.exec(html)?.[0] ?? "";

  it("is found (not vacuous), wraps the checkbox, and is at least 44px tall", () => {
    expect(label).toContain('name="termsAccepted"');
    expect(label).toMatch(/<label[^>]*class="[^"]*min-h-11/);
  });

  it("keeps the 16px box at 16px (a bigger box is not a bigger target)", () => {
    expect(label).toMatch(/<input[^>]*class="[^"]*h-4 w-4/);
  });

  it("keeps 'Privacy Policy' and its full stop on one line", () => {
    expect(label).toMatch(/<span class="[^"]*whitespace-nowrap[^"]*"><a [^>]*>Privacy Policy<\/a>\.<\/span>/);
  });

  it("puts the sentence in ONE inline element, so its words wrap as a sentence rather than as flex items", () => {
    expect(label).toMatch(/<\/span>\s*<\/label>$/);
    expect(label).toMatch(/<span>I agree to Talentrah(?:&#x27;|')s /);
  });

  it("still links the Terms and the Privacy Policy", () => {
    expect(label).toContain('href="/legal/terms"');
    expect(label).toContain('href="/legal/privacy"');
  });
});
