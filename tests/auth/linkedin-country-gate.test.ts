/**
 * SIGNUP-COUNTRY-LINKEDIN-1: the country step is asked of a first LinkedIn sign-up as well as a first Google one. LinkedIn sends no country and handle_new_user only copies metadata, so a LinkedIn account's
 * profile stayed empty. The gate keys on an EXPLICIT list of providers (google, linkedin_oidc), never "everything that is not email": an unknown, anonymous or absent provider stays ungated. The existing Google cases are
 * in tests/auth/google-country-gate.test.ts and are not edited. Pure functions plus a static render of the step page with its session stubbed; no network, no database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import { COUNTRY_STEP_PATH, googleCountryGate, needsGoogleCountryStep } from "@/lib/auth/google-country-gate";

const world = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown>; profile: Record<string, unknown> },
  redirectedTo: null as string | null,
}));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), getOptionalUser: async () => world.session }));
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), headers: async () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    world.redirectedTo = to;
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/google-country-actions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/google-country-actions")>()), saveGoogleCountryAction: async () => ({ status: "idle" }) }));

const { default: CountryStepPage } = await import("@/app/welcome/country/page");

const user = (app: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({ id: "u1", app_metadata: app, user_metadata: meta }) as unknown as User;
const linkedin = (meta: Record<string, unknown> = {}) => user({ provider: "linkedin_oidc", providers: ["linkedin_oidc"] }, { full_name: "Agnes A", ...meta });
const run = (u: User | null, path: string) => googleCountryGate(new NextRequest(`http://localhost${path}`), NextResponse.next(), u);

describe("1. who needs the step: a LinkedIn account", () => {
  it("with no country in its metadata", () => expect(needsGoogleCountryStep(linkedin())).toBe(true));
  it("with a country in its metadata: not asked", () => expect(needsGoogleCountryStep(linkedin({ country: "Nigeria" }))).toBe(false));
  it("with a blank or whitespace country: still no country", () => {
    expect(needsGoogleCountryStep(linkedin({ country: "" }))).toBe(true);
    expect(needsGoogleCountryStep(linkedin({ country: "   " }))).toBe(true);
  });
});

describe("2. every other provider stays ungated", () => {
  it.each([
    ["email", user({ provider: "email", providers: ["email"] })],
    ["anonymous", user({ provider: "anonymous" })],
    ["no provider at all", user({})],
    ["an unknown provider", user({ provider: "some_new_idp" })],
    ["a provider that only looks like LinkedIn", user({ provider: "linkedin" })],
    ["another social provider", user({ provider: "github" })],
  ])("%s, no country: not asked", (_label, u) => expect(needsGoogleCountryStep(u)).toBe(false));
  it("an email account that linked LinkedIn later keeps provider email and is not asked", () => expect(needsGoogleCountryStep(user({ provider: "email", providers: ["email", "linkedin_oidc"] }))).toBe(false));
});

describe("4. the proxy gate for a LinkedIn account with no country", () => {
  it.each(["/dashboard", "/jobs", "/onboarding", "/settings?tab=profile"])("is sent to the step from %s, with the destination kept", (path) => {
    const res = run(linkedin(), path)!;
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe(COUNTRY_STEP_PATH);
    expect(to.searchParams.get("next")).toBe(path);
  });
  it.each([COUNTRY_STEP_PATH, `${COUNTRY_STEP_PATH}/sync`, "/auth/callback", "/api/anything", "/login", "/admin/people", "/employer/jobs", "/employer/onboarding", "/talentrah-mark.svg", "/_next/static/x.js"])(
    "is NOT redirected from the exempt path %s",
    (path) => expect(run(linkedin(), path)).toBeNull(),
  );
  it("a LinkedIn account that has a country is untouched", () => expect(run(linkedin({ country: "Kenya" }), "/dashboard")).toBeNull());
  it("a signed-out visitor is never touched", () => {
    for (const path of ["/dashboard", "/jobs", "/jobs/remote", "/tracker"]) expect(run(null, path), path).toBeNull();
  });
  it("an email user with a null country still reaches the dashboard untouched", () => expect(run(user({ provider: "email" }), "/dashboard")).toBeNull());
});

describe("5. the step page for a LinkedIn account", () => {
  const render = async (next?: string) => renderToStaticMarkup(await CountryStepPage({ searchParams: Promise.resolve(next ? { next } : {}) }));
  beforeEach(() => {
    world.session = { user: linkedin() as unknown as Record<string, unknown>, profile: { first_name: "Agnes", country: null } };
    world.redirectedTo = null;
  });
  it("with no country anywhere: shows the form", async () => {
    const html = await render("/jobs/abc");
    expect(html).toContain("Where are you based?");
    expect(html).toContain('name="next" value="/jobs/abc"');
    expect(world.redirectedTo).toBeNull();
  });
  it("with a country already on the profile: the sync route is used, no form", async () => {
    world.session = { user: linkedin() as unknown as Record<string, unknown>, profile: { first_name: "Agnes", country: "Ghana" } };
    await expect(render("/jobs/abc")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/welcome/country/sync?next=%2Fjobs%2Fabc");
  });
  it("with a country already in its metadata: straight on", async () => {
    world.session = { user: linkedin({ country: "Kenya" }) as unknown as Record<string, unknown>, profile: { country: "Kenya" } };
    await expect(render("/dashboard")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/dashboard");
  });
  it("an email user is sent straight on", async () => {
    world.session = { user: { id: "e", app_metadata: { provider: "email" }, user_metadata: {} }, profile: { country: null } };
    await expect(render("/settings")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/settings");
  });
});
