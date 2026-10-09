/**
 * The Google country step's proxy gate and its locale prefill (owner, 9 Oct). Pure functions: no network, no database.
 *
 * The case that matters most for CI is "email user with a null country": the pooled test users and minted e2e sessions are exactly that, and must reach the dashboard. The gate keys on the Google
 * PROVIDER, not on an empty country alone.
 */
import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { COUNTRY_STEP_PATH, googleCountryGate, isCountryStepExempt, needsGoogleCountryStep } from "@/lib/auth/google-country-gate";
import { countryFromAcceptLanguage } from "@/lib/auth/country-from-locale";
import { PENDING_DELETION_PATH } from "@/lib/auth/pending-deletion-path";

const user = (app: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({ id: "u1", app_metadata: app, user_metadata: meta }) as unknown as User;
const googleNoCountry = user({ provider: "google", providers: ["google"] }, { full_name: "Agnes A" });
const emailNullCountry = user({ provider: "email", providers: ["email"] }, {});
const run = (u: User | null, path: string) => googleCountryGate(new NextRequest(`http://localhost${path}`), NextResponse.next(), u);

describe("who needs the step", () => {
  it("a Google account with no country in its metadata", () => expect(needsGoogleCountryStep(googleNoCountry)).toBe(true));
  it("a blank or whitespace country is still no country", () => {
    expect(needsGoogleCountryStep(user({ provider: "google" }, { country: "" }))).toBe(true);
    expect(needsGoogleCountryStep(user({ provider: "google" }, { country: "   " }))).toBe(true);
  });
  it("a Google account that has a country never needs it", () => expect(needsGoogleCountryStep(user({ provider: "google" }, { country: "Nigeria" }))).toBe(false));
  it("an EMAIL account with a null country does NOT (pooled test users and minted e2e sessions are exactly this)", () => expect(needsGoogleCountryStep(emailNullCountry)).toBe(false));
  it("an email account that linked Google later keeps provider email and is not asked", () => expect(needsGoogleCountryStep(user({ provider: "email", providers: ["email", "google"] }, {}))).toBe(false));
});

describe("the proxy gate", () => {
  it("a Google user with no country is sent to the step from a dashboard URL, with the destination kept", () => {
    const res = run(googleNoCountry, "/dashboard")!;
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe(COUNTRY_STEP_PATH);
    expect(to.searchParams.get("next")).toBe("/dashboard");
  });
  it("a job deep link in the app keeps its path and query through the step", () => {
    const to = new URL(run(googleNoCountry, "/settings?tab=profile")!.headers.get("location")!);
    expect(to.searchParams.get("next")).toBe("/settings?tab=profile");
  });
  it("the typical first landing, /onboarding, is gated too", () => expect(run(googleNoCountry, "/onboarding")?.status).toBe(307));
  it("an email user with a null country reaches the dashboard untouched", () => {
    for (const path of ["/dashboard", "/onboarding", "/settings", "/resume-builder"]) expect(run(emailNullCountry, path), path).toBeNull();
  });
  it("a Google user who has a country is untouched", () => expect(run(user({ provider: "google" }, { country: "Kenya" }), "/dashboard")).toBeNull());
  it("a signed-out request is not this gate's business", () => expect(run(null, "/dashboard")).toBeNull());
  it("exempt: the step itself, auth routes, the API, login, the deletion path and its confirm page, admin, static assets", () => {
    for (const path of [COUNTRY_STEP_PATH, `${COUNTRY_STEP_PATH}/sync`, "/auth/callback", "/api/auth/anything", "/api/tailoring", "/login", PENDING_DELETION_PATH, "/settings/delete-account/confirm", "/admin/people", "/_next/static/x.js", "/talentrah-mark.svg", "/robots.txt"]) {
      expect(isCountryStepExempt(path), path).toBe(true);
      expect(run(googleNoCountry, path), path).toBeNull();
    }
  });
  it("employer paths are NOT gated (the owner can decide later)", () => {
    for (const path of ["/employer/jobs", "/employer/profile", "/employer/onboarding"]) expect(run(googleNoCountry, path), path).toBeNull();
  });
  it("the signed-in landing pages that are public for a signed-out visitor ARE gated for a Google user with no country (GOOGLE-COUNTRY-1): /jobs, /tracker, /scholarships, /mentorship, /refer, and below them", () => {
    for (const path of ["/jobs", "/jobs/remote", "/jobs/abc-123", "/tracker", "/scholarships", "/scholarships/fully-funded", "/mentorship", "/mentorship/apply", "/refer"]) {
      const res = run(googleNoCountry, path);
      expect(res?.status, path).toBe(307);
      expect(new URL(res!.headers.get("location")!).searchParams.get("next"), path).toBe(path);
    }
  });
  it("the same public pages are untouched for a SIGNED-OUT visitor and a crawler (no user, no gate), an email user, and a Google user who has a country", () => {
    for (const path of ["/jobs", "/jobs/remote", "/scholarships", "/mentorship", "/tracker", "/refer"]) {
      expect(run(null, path), `${path} signed out`).toBeNull();
      expect(run(emailNullCountry, path), `${path} email`).toBeNull();
      expect(run(user({ provider: "google" }, { country: "Ghana" }), path), `${path} has a country`).toBeNull();
    }
  });
  it("marketing, blog and legal pages are never gated, whoever is signed in", () => {
    for (const path of ["/", "/blog", "/blog/some-post", "/about", "/legal/privacy", "/contact", "/vs/jobright", "/jobs-board"]) expect(run(googleNoCountry, path), path).toBeNull();
  });
  it("the destination is always a path on this site", () => {
    const to = new URL(run(googleNoCountry, "/settings")!.headers.get("location")!);
    expect(to.origin).toBe("http://localhost");
    expect(to.searchParams.get("next")!.startsWith("/")).toBe(true);
    expect(to.searchParams.get("next")!.startsWith("//")).toBe(false);
  });
});

describe("the prefill from the browser's locale", () => {
  it.each([
    ["en-NG,en;q=0.9", "Nigeria"],
    ["en-GB", "United Kingdom"],
    ["en-US,en;q=0.8", "United States"],
    ["en;q=0.5,fr-FR;q=0.9", "France"],
    ["en-Latn-NG", "Nigeria"],
    ["en, en-CA;q=0.7", "Canada"],
  ])("%s -> %s", (header, country) => expect(countryFromAcceptLanguage(header)).toBe(country));
  it.each([["en"], ["en,fr;q=0.8"], ["*"], [""], ["xx-ZZ"], ["en-001"], ["de-"]])("%j maps to no listed country: nothing is suggested", (header) => expect(countryFromAcceptLanguage(header)).toBeNull());
  it("no header at all: nothing", () => {
    expect(countryFromAcceptLanguage(null)).toBeNull();
    expect(countryFromAcceptLanguage(undefined)).toBeNull();
  });
  it("only the first mappable tag in the browser's order wins", () => expect(countryFromAcceptLanguage("en-ZA, en-NG;q=0.9")).toBe("South Africa"));
});
