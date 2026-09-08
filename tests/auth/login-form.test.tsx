/**
 * LoginForm's password reveal control — the shared `PasswordField`
 * (src/components/ui/password-field.tsx), extracted from
 * admin-login-form.tsx, now used here too. Mirrors
 * tests/admin/admin-login-form.test.tsx's own shape: renders to static
 * markup (no jsdom in this repo), so this covers what the server sends —
 * the control is a real button, it starts hidden, the field stays a real
 * password field, and the toggle points at the field it controls. The
 * BEHAVIOUR (clicking flips the type) needs a real browser and lives in
 * e2e — see e2e/seeker-login-password-toggle.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginForm } from "@/components/auth/login-form";

const html = () => renderToStaticMarkup(<LoginForm />);

describe("the password visibility control", () => {
  it("is a real button that cannot submit the form", () => {
    const markup = html();
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
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).not.toContain('aria-label="Hide password"');
  });

  it("leaves the field a real password field, so password managers still behave", () => {
    const markup = html();
    expect(markup).toMatch(/<input[^>]*id="password"[^>]*type="password"/);
    expect(markup).toMatch(/<input[^>]*id="password"[^>]*autocomplete="current-password"/i);
  });

  it("points the control at the field it controls", () => {
    expect(html()).toContain('aria-controls="password"');
  });
});
