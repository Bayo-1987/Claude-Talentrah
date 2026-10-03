/**
 * Settings, "Sign out of all devices": the control is offered, and the consequence is stated before anything is submitted.
 * The interaction (ask, then confirm, then both browsers signed out) is covered end to end in e2e/sign-out-scope.spec.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/actions", () => ({ signOutEverywhereAction: vi.fn() }));

const { SignOutEverywhere, SIGN_OUT_EVERYWHERE_WARNING } = await import("@/app/(app)/settings/sign-out-everywhere");

describe("SignOutEverywhere", () => {
  const html = renderToStaticMarkup(<SignOutEverywhere />);

  it("offers the action, and explains what the menu's Sign out does instead", () => {
    expect(html).toContain("Sign out of all devices");
    expect(html).toContain("on this device only");
  });

  it("does not show the confirmation, or a submit button, until asked", () => {
    expect(html).not.toContain(SIGN_OUT_EVERYWHERE_WARNING);
    expect(html).not.toContain('type="submit"');
  });

  it("the confirmation states exactly what it does", () => {
    expect(SIGN_OUT_EVERYWHERE_WARNING).toContain("every device and browser, including this one");
    expect(SIGN_OUT_EVERYWHERE_WARNING).toContain("log in again");
  });
});
