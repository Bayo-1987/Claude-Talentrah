/**
 * COUNTRY-DEFAULT-GEO-1. The Google country step suggested the country from the browser's language only, so a person in Nigeria with an en-US browser was shown "United States". The suggestion now
 * comes from the request's IP country first (Vercel's x-vercel-ip-country), then the browser language. Still only a SUGGESTION: it pre-selects the box and nothing is saved before Continue.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNUP_COUNTRIES } from "@/lib/auth/countries";
import { COUNTRY_IP_HEADER, countryFromIpCode, suggestCountry } from "@/lib/auth/country-from-locale";

describe("countryFromIpCode: a two-letter code to a listed sign-up country", () => {
  it.each([
    ["NG", "Nigeria"],
    ["GB", "United Kingdom"],
    ["US", "United States"],
    ["CA", "Canada"],
    ["GH", "Ghana"],
    ["KE", "Kenya"],
    ["ZA", "South Africa"],
  ])("%s -> %s", (code, name) => expect(countryFromIpCode(code)).toBe(name));

  it("accepts lowercase and surrounding space", () => {
    expect(countryFromIpCode("ng")).toBe("Nigeria");
    expect(countryFromIpCode(" Ng ")).toBe("Nigeria");
  });

  it.each([["XX"], ["T1"], [""], ["   "], ["N"], ["NGA"], ["12"], ["Other"], ["OTHER"]])("%j gives nothing", (code) => expect(countryFromIpCode(code)).toBeNull());
  it("null and undefined give nothing", () => {
    expect(countryFromIpCode(null)).toBeNull();
    expect(countryFromIpCode(undefined)).toBeNull();
  });

  it("every country it can return is on the sign-up list, and 'Other' is never returned", () => {
    const seen = new Set<string>();
    for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const name = countryFromIpCode(`${a}${b}`);
      if (name) seen.add(name);
    }
    expect(seen.size).toBeGreaterThan(200);
    for (const name of seen) expect(SIGNUP_COUNTRIES).toContain(name);
    expect(seen.has("Other")).toBe(false);
  });
});

describe("suggestCountry: IP first, then the browser language", () => {
  it("IP NG with an en-US browser gives Nigeria, from the IP", () => {
    expect(suggestCountry("NG", "en-US,en;q=0.9")).toEqual({ country: "Nigeria", source: "ip" });
  });
  it("no IP header falls back to the language", () => {
    expect(suggestCountry(null, "en-GB,en;q=0.9")).toEqual({ country: "United Kingdom", source: "browser" });
    expect(suggestCountry(undefined, "en-NG")).toEqual({ country: "Nigeria", source: "browser" });
  });
  it("an IP country that cannot be mapped (XX, T1, empty) falls back to the language", () => {
    for (const ip of ["XX", "T1", ""]) expect(suggestCountry(ip, "en-GH")).toEqual({ country: "Ghana", source: "browser" });
  });
  it("neither gives nothing: an empty box and no hint", () => {
    expect(suggestCountry(null, null)).toEqual({ country: null, source: null });
    expect(suggestCountry("XX", "en")).toEqual({ country: null, source: null });
    expect(suggestCountry("", "")).toEqual({ country: null, source: null });
  });
  it("the language-only behaviour is exactly what it was", () => {
    expect(suggestCountry(null, "en-NG,en;q=0.9").country).toBe("Nigeria");
    expect(suggestCountry(null, "en").country).toBeNull();
  });
});

describe("the header is read in one place, and nothing logs the IP or the country", () => {
  const root = path.join(__dirname, "../../src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(n)) files.push(f);
    }
  };
  walk(root);
  const rel = (f: string) => path.relative(root, f);

  it("the header name appears in exactly one source file (the constant), and exactly one file reads it", () => {
    expect(COUNTRY_IP_HEADER).toBe("x-vercel-ip-country");
    const withName = files.filter((f) => readFileSync(f, "utf8").includes("x-vercel-ip-country")).map(rel);
    expect(withName).toEqual(["lib/auth/country-from-locale.ts"]);
    const readers = files.filter((f) => readFileSync(f, "utf8").includes("COUNTRY_IP_HEADER") && !f.endsWith("country-from-locale.ts")).map(rel);
    expect(readers).toEqual(["app/welcome/country/page.tsx"]);
  });

  it("neither the mapping module nor the page logs anything", () => {
    for (const f of ["lib/auth/country-from-locale.ts", "app/welcome/country/page.tsx"]) {
      expect(readFileSync(path.join(root, f), "utf8"), f).not.toMatch(/console\.|logger|captureEvent|recordEvent/);
    }
  });
});
