/**
 * Google One Tap must survive the remembered-account card (LOGIN-REMEMBERED-ACCOUNT-1).
 *
 * One Tap shows whether or not this browser remembers an email, on both /login and /signup. The pages are async server components that
 * need a request (cookies, searchParams, a Supabase session), so this reads their SOURCE rather than rendering them, and renders
 * LoginForm itself, the only thing the card lives in, with and without a remembered email.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginForm } from "@/components/auth/login-form";

const read = (p: string) => readFileSync(p, "utf8");
const login = read("src/app/(auth)/login/page.tsx");
const signup = read("src/app/(auth)/signup/page.tsx");
const loginForm = read("src/components/auth/login-form.tsx");
const card = read("src/components/auth/remembered-account-card.tsx");

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["login", login],
  ["signup", signup],
])("the %s page", (_name, src) => {
  it("imports and mounts <GoogleOneTap /> exactly once, with no props", () => {
    expect(src).toMatch(/import \{ GoogleOneTap \} from "@\/components\/auth\/google-one-tap";/);
    expect(src.match(/<GoogleOneTap\b/g)).toHaveLength(1);
    expect(src).toMatch(/<GoogleOneTap \/>/);
  });

  it("mounts it as the first child of the page's root column, ahead of everything else", () => {
    const root = src.indexOf('<div className="flex flex-col gap-8">');
    const tap = src.indexOf("<GoogleOneTap />");
    expect(root).toBeGreaterThan(-1);
    expect(tap).toBeGreaterThan(root);
    expect(src.slice(root, tap).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<div className="flex flex-col gap-8">/, "").trim()).toBe("");
  });

  it("does not put it inside any form component, so a card can never wrap or replace it", () => {
    const tap = src.indexOf("<GoogleOneTap />");
    const forms = ["<LoginForm", "<SignupForm", "<OAuthButtons"].map((t) => src.indexOf(t)).filter((i) => i > -1);
    for (const at of forms) expect(tap).toBeLessThan(at);
  });
});

describe("the card is below One Tap, never around it", () => {
  it("LoginForm and the card know nothing about One Tap", () => {
    expect(loginForm).not.toMatch(/google-one-tap|GoogleOneTap|one-tap/i);
    expect(card).not.toMatch(/google-one-tap|GoogleOneTap|one-tap/i);
  });

  it("the login page renders LoginForm after <GoogleOneTap />", () => {
    expect(login.indexOf("<GoogleOneTap />")).toBeLessThan(login.indexOf("<LoginForm"));
  });

  it("the login page source is unchanged by the card: no new props on LoginForm or OAuthButtons", () => {
    expect(login).toMatch(/<LoginForm redirectTo=\{redirectTo \|\| undefined\} \/>/);
    expect(login).toMatch(/<OAuthButtons redirectTo=\{redirectTo \|\| undefined\} \/>/);
  });
});

describe("LoginForm markup, with and without a remembered email", () => {
  // Server render has no browser storage, so it is identical either way: the form, no card. Hydration is what swaps it, and that
  // swap lives inside LoginForm, below One Tap.
  const stub = (value: string | null) =>
    vi.stubGlobal("localStorage", {
      getItem: () => value,
      setItem: () => {},
      removeItem: () => {},
    });

  it.each([
    ["nothing stored", null],
    ["a remembered email", "ada@example.com"],
  ])("renders the ordinary form and no card on the server (%s)", (_n, value) => {
    stub(value);
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toContain('name="email"');
    expect(html).toContain("Log in");
    expect(html).not.toContain("Continue as");
    expect(html).not.toContain("Use another account");
    expect(html).not.toMatch(/google/i);
  });
});
