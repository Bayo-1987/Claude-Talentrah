/**
 * The admin sign-in form's two new affordances, and the one message it must
 * keep refusing to improve.
 *
 * WHAT IS TESTED WHERE, and why it is split.
 *
 * This file renders the form to static markup, which is what the rest of the
 * repo's component tests do and needs no DOM implementation. That covers the
 * shape the server sends: the control is a real button, it starts hidden, the
 * field is still a password field, and the link goes to the seeker route.
 *
 * The BEHAVIOUR — clicking flips the type, aria-pressed tracks it, and the
 * click does not submit the form — needs a browser, and lives in
 * e2e/admin-login-password-toggle.spec.ts. Asserting it here would mean adding
 * jsdom to a repo that has none, to prove something Playwright already proves
 * against the real page.
 *
 * The error-message assertion is the important one to keep. It is not about
 * the toggle at all: it pins the anti-enumeration decision so that a future
 * edit making the message "more helpful" fails here rather than shipping.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { adminLoginAction } from "@/lib/admin/actions";
import { initialAdminLoginState } from "@/lib/admin/login-state";

const html = () => renderToStaticMarkup(<AdminLoginForm />);

describe("the password visibility control", () => {
  it("is a real button that cannot submit the form", () => {
    const markup = html();

    // A <button> inside a form defaults to type="submit". Revealing the
    // password would then post the form, which is the failure this asserts
    // against — and it is invisible in review, because the markup looks fine.
    expect(markup).toContain('type="button"');

    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length, "expected the toggle and the submit button").toBe(2);
    for (const b of buttons) {
      expect(
        /type="(button|submit)"/.test(b),
        `a button with no explicit type defaults to submit: ${b}`,
      ).toBe(true);
    }
  });

  it("starts hidden, and says so both ways", () => {
    const markup = html();

    // The state a reload lands on. Nothing persists it, so this is also the
    // state after a failed submit.
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).not.toContain('aria-label="Hide password"');
  });

  it("leaves the field a password field, so password managers still behave", () => {
    const markup = html();
    expect(markup).toMatch(/<input[^>]*id="admin-password"[^>]*type="password"/);
    expect(markup).toMatch(/<input[^>]*id="admin-password"[^>]*autocomplete="current-password"/i);
  });

  it("points the control at the field it controls", () => {
    expect(html()).toContain('aria-controls="admin-password"');
  });
});

/*
 * NO TEST FOR A FORGOT-PASSWORD LINK, because there is deliberately no link.
 *
 * It was built, and is held until custom SMTP is configured: the project's
 * reset-email quota is two per hour and project-wide, so the admin door would
 * be advertising a remedy any two requests can switch off for an hour. The
 * reasoning, and what unblocks it, is in src/app/admin/login/page.tsx and
 * docs/admin-auth.md.
 *
 * Not pinned with an assertion that the link is ABSENT: the intended end state
 * is that it exists, and a test forbidding it would have to be deleted by the
 * person adding it, which is the wrong signal to leave them.
 */
describe("the failure message stays useless to someone guessing", () => {
  /*
   * Invalid input short-circuits before any network call, so this exercises the
   * real action rather than a copy of its string — and does it offline.
   *
   * The value being pinned is the DECISION: one message for a wrong password
   * and for a correct password on an account that is not an operator. Anything
   * that distinguishes those tells whoever is guessing which half they got
   * right, and "this address is an operator" is the valuable half.
   */
  it("is exactly the generic failure, for input it never even sends", async () => {
    const result = await adminLoginAction(initialAdminLoginState, new FormData());
    expect(result.error).toBe("Incorrect email or password.");
  });

  it("says nothing about which half was wrong", async () => {
    const withEmailOnly = new FormData();
    withEmailOnly.set("email", "someone@example.com");

    const result = await adminLoginAction(initialAdminLoginState, withEmailOnly);
    expect(result.error).toBe("Incorrect email or password.");

    for (const leak of ["operator", "admin", "not found", "no such", "password is", "email is"]) {
      expect(
        result.error?.toLowerCase().includes(leak),
        `the failure message leaked "${leak}"`,
      ).toBe(false);
    }
  });
});
