/**
 * AE-1 — the local dev stack's "Confirm sign up" email agrees with the one in production.
 *
 * Production's template is docs/auth-email-templates/confirm-signup.html (the six-digit-code version, S1-101), pasted into the Supabase dashboard; the repo copy is pinned by
 * tests/auth/confirm-signup-template.test.ts. The local stack (`supabase start`, and the ephemeral per-job stack CI starts) reads supabase/templates/confirmation.html through
 * supabase/config.toml, and it was still the old link version: a developer testing signup locally saw a different email, with a link, and a different subject. This pins that the
 * two cannot drift apart again:
 *   - the local file IS the production file, byte for byte (so every wording, layout and "no link" rule tested on the production copy holds for it too);
 *   - config.toml points the confirmation template at it, with the same subject;
 *   - config.toml's OTP expiry is 900 seconds, so "The code expires in 15 minutes." is true locally as it is in production (README.md, same folder, says the claim is true only then).
 * Pure file reads: no database, no browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const production = read("docs/auth-email-templates/confirm-signup.html");
const local = read("supabase/templates/confirmation.html");
const subject = read("docs/auth-email-templates/confirm-signup.subject.txt").trim();
const config = read("supabase/config.toml");

/** The body of one `[table]` in config.toml, up to the next table header. */
function table(name: string): string {
  const start = config.indexOf(`[${name}]`);
  if (start === -1) throw new Error(`config.toml has no [${name}]`);
  const rest = config.slice(start + name.length + 2);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the local confirmation template is the production one", () => {
  it("is byte-for-byte docs/auth-email-templates/confirm-signup.html", () => {
    expect(local).toBe(production);
  });

  it("is the code version: the code variable once, and no confirmation link, site URL or anchor", () => {
    expect(local.match(/\{\{ \.Token \}\}/g)).toHaveLength(1);
    expect(local).not.toContain("ConfirmationURL");
    expect(local).not.toContain("SiteURL");
    expect(local).not.toMatch(/<a[\s>]/i);
    expect(local).not.toMatch(/href=/i);
  });

  it("carries no template action other than the code (a field written anywhere, comments included, would be evaluated)", () => {
    expect([...local.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0])).toEqual(["{{ .Token }}"]);
  });
});

describe("supabase/config.toml wires it the same way", () => {
  const confirmation = table("auth.email.template.confirmation");

  it("points the confirmation template at that file", () => {
    expect(confirmation).toMatch(/content_path\s*=\s*"\.\/supabase\/templates\/confirmation\.html"/);
  });

  it("uses the production subject", () => {
    expect(confirmation).toMatch(new RegExp(`subject\\s*=\\s*"${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });

  it("sets the email OTP expiry to 900 seconds, the same 15 minutes the email promises", () => {
    expect(config).toMatch(/^otp_expiry\s*=\s*900\s*$/m);
    expect(production).toContain("The code expires in 15 minutes.");
  });

  it("leaves the recovery and invite templates pointing at their own files", () => {
    expect(table("auth.email.template.recovery")).toMatch(/content_path\s*=\s*"\.\/supabase\/templates\/recovery\.html"/);
    expect(table("auth.email.template.invite")).toMatch(/content_path\s*=\s*"\.\/supabase\/templates\/invite\.html"/);
  });
});
