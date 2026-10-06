/**
 * The owner-dashboard-step rule (AE-2, widened): some settings live only in a console the repo cannot change (Supabase auth, email, redirect URLs and SMTP; Vercel
 * environment variables; a provider's console). A change that depends on one ships with the exact owner step written down, and is not done until the owner
 * confirms it is live. This test keeps the rule findable and wired in three places: the rule's own page, the PR template that asks the question on every PR,
 * and the auth-email README (the first standing record, with its own table pinned by tests/auth/auth-email-dashboard-steps.test.ts).
 * DOCS_ROOT points the test at another checkout, to show it red against a changed copy; it must never be set in CI.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

if (process.env.CI && process.env.DOCS_ROOT) throw new Error("DOCS_ROOT is set in CI. Unset it: this test must read the real checkout there.");
const ROOT = process.env.DOCS_ROOT ?? process.cwd();
const read = (rel: string) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), "utf8") : "");
const flat = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ");

const RULE = "docs/owner-dashboard-steps.md";
const TEMPLATE = "docs/pull_request_template.md";
const AUTH_README = "docs/auth-email-templates/README.md";

describe("the rule's own page", () => {
  const rule = read(RULE);
  const text = flat(rule);

  it("exists and states the rule with its duties", () => {
    expect(rule, `${RULE} is missing`).not.toBe("");
    expect(rule).toMatch(/^## The rule/m);
    expect(text).toMatch(/owner dashboard step/i);
    expect(text).toMatch(/the exact value/i);
    expect(text).toMatch(/not done until the owner confirms it is live/i);
  });

  it.each([
    ["Supabase", /Supabase/],
    ["auth and email settings", /auth.*email|email.*auth/i],
    ["redirect URLs", /redirect URL/i],
    ["SMTP", /SMTP/],
    ["Vercel environment variables", /Vercel.*environment variable|environment variable.*Vercel/i],
    ["provider consoles", /provider.{0,12}console/i],
  ])("names %s as a dashboard-only setting", (_name, rx) => {
    expect(text).toMatch(rx);
  });

  it("points at the PR template and at the auth-email table, and both exist", () => {
    expect(text).toContain("docs/pull_request_template.md");
    expect(text).toContain("docs/auth-email-templates/README.md");
    expect(existsSync(path.join(ROOT, TEMPLATE))).toBe(true);
    expect(existsSync(path.join(ROOT, AUTH_README))).toBe(true);
  });
});

describe("the PR template asks the question on every PR", () => {
  const template = read(TEMPLATE);
  const text = flat(template);

  it("exists", () => {
    expect(template, `${TEMPLATE} is missing: GitHub reads it from the root, docs/ or .github/`).not.toBe("");
  });

  it("has the checkbox 'Needs an owner dashboard step: yes / no' with 'if yes, which'", () => {
    expect(template).toMatch(/^- \[ \] .*Needs an owner dashboard step: \**yes \/ no/m); // the "yes / no" may be bold
    expect(text).toMatch(/if yes, which/i);
  });

  it("says the item is not done until the owner confirms it is live, and links the rule", () => {
    expect(text).toMatch(/not done until the owner confirms it is live/i);
    expect(text).toContain("docs/owner-dashboard-steps.md");
  });

  it("keeps the sections the repo's PRs already use", () => {
    expect(template).toMatch(/^## What changes/m);
    expect(template).toMatch(/^## Test/m);
  });
});

describe("the auth-email README is the first standing record", () => {
  it("links the general rule", () => {
    expect(read(AUTH_README)).toContain("owner-dashboard-steps.md");
  });
});
