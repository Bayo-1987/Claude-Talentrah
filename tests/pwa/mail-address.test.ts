/**
 * Where the local mail catcher is, for the auth-link e2e (e2e/support/auth-links.ts).
 *
 * The Supabase CLI puts the API on one port and Mailpit three above it (supabase/config.toml: 54321 and 54324, and CI uses the same), so the
 * address is derived from NEXT_PUBLIC_SUPABASE_URL instead of being typed in: a stack on other ports (a developer's second stack) still works. The
 * first version hard-coded 55324, the port of the author's private stack, and four specs failed in CI with ECONNREFUSED on 55324.
 */
import { describe, expect, it } from "vitest";
import { mailpitUrl } from "../../e2e/support/mail-address";

describe("mailpitUrl", () => {
  it.each([
    ["http://127.0.0.1:54321", "http://127.0.0.1:54324"],
    ["http://127.0.0.1:55321", "http://127.0.0.1:55324"],
    ["http://localhost:54321", "http://localhost:54324"],
    ["http://127.0.0.1:54321/", "http://127.0.0.1:54324"],
    ["http://127.0.0.1:60001", "http://127.0.0.1:60004"],
  ])("%s -> %s", (api, expected) => {
    expect(mailpitUrl(api, undefined)).toBe(expected);
  });

  it("MAILPIT_URL overrides the derivation", () => {
    expect(mailpitUrl("http://127.0.0.1:54321", "http://127.0.0.1:9999")).toBe("http://127.0.0.1:9999");
  });

  it("an empty MAILPIT_URL is not an override", () => {
    expect(mailpitUrl("http://127.0.0.1:54321", "")).toBe("http://127.0.0.1:54324");
  });

  it.each(["https://abc.supabase.co", "http://10.0.0.5:54321", "http://example.com:54321"])("refuses a non-loopback API host: %s", (api) => {
    expect(() => mailpitUrl(api, undefined)).toThrow(/loopback|local/i);
  });

  it("refuses an override that is not loopback either", () => {
    expect(() => mailpitUrl("http://127.0.0.1:54321", "https://mail.example.com")).toThrow(/loopback|local/i);
  });

  it("refuses an API URL with no port or no URL at all (nothing to derive from)", () => {
    expect(() => mailpitUrl("http://127.0.0.1", undefined)).toThrow(/port/i);
    expect(() => mailpitUrl(undefined, undefined)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
