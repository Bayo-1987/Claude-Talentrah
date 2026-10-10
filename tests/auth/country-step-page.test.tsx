/**
 * The Google country step page (owner, 9 Oct): the exact copy from the owner's mockup (specs/country-step.png), who is sent where, and the prefill.
 * Static render of the server page with its session and header stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const world = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown>; profile: Record<string, unknown> },
  acceptLanguage: null as string | null,
  redirectedTo: null as string | null,
}));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), getOptionalUser: async () => world.session }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(world.acceptLanguage ? { "accept-language": world.acceptLanguage } : {}) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    world.redirectedTo = to;
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/google-country-actions", () => ({ saveGoogleCountryAction: async () => ({ status: "idle" }) }));

const { default: CountryStepPage } = await import("@/app/welcome/country/page");

const google = (meta: Record<string, unknown> = {}) => ({ id: "u1", app_metadata: { provider: "google" }, user_metadata: meta });
const render = async (next?: string) => {
  const jsx = await CountryStepPage({ searchParams: Promise.resolve(next ? { next } : {}) });
  return renderToStaticMarkup(jsx);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();

beforeEach(() => {
  world.session = { user: google(), profile: { first_name: "Agnes", country: null } };
  world.acceptLanguage = null;
  world.redirectedTo = null;
});

describe("the copy, exactly", () => {
  it("eyebrow, heading, welcome line, label, placeholder, button, footnote", async () => {
    const t = text(await render());
    expect(t).toContain("One last step");
    expect(t).toContain("Where are you based?");
    expect(t).toContain("Welcome, Agnes. We use your country to show jobs, salaries and scholarships that fit where you live.");
    expect(t).toContain("Country");
    expect(t).toContain("Select your country");
    expect(t).toContain("Continue to my dashboard");
    expect(t).toContain("You can change this later in Settings.");
  });
  it("the first name comes from the profile, else the Google name, else the line starts 'Welcome.'", async () => {
    world.session = { user: google({ full_name: "Agnes Adeyemi" }), profile: { first_name: null, country: null } };
    expect(text(await render())).toContain("Welcome, Agnes. We use");
    world.session = { user: google(), profile: { first_name: null, country: null } };
    expect(text(await render())).toContain("Welcome. We use your country");
  });
  it("the form has the same country list as sign-up: first Nigeria, the diaspora three, then A to Z, 'Other' last", async () => {
    const html = await render();
    const decode = (v: string) => v.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const options = [...html.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => decode(m[1]));
    expect(options.slice(0, 5)).toEqual(["", "Nigeria", "United Kingdom", "United States", "Canada"]);
    expect(options[options.length - 1]).toBe("Other");
    const { SIGNUP_COUNTRIES } = await import("@/lib/auth/countries");
    expect(options.slice(1)).toEqual([...SIGNUP_COUNTRIES]);
  });
  it("the page carries the destination in a hidden field", async () => {
    expect(await render("/jobs/abc")).toContain('name="next" value="/jobs/abc"');
  });
});

describe("the prefill and its hint", () => {
  it("a locale that maps to a listed country pre-selects it and shows the hint", async () => {
    world.acceptLanguage = "en-NG,en;q=0.9";
    const html = await render();
    expect(html).toMatch(/<option[^>]*value="Nigeria"[^>]*selected|<option[^>]*selected[^>]*value="Nigeria"/);
    expect(text(html)).toContain("Suggested from your browser. Change it if it's wrong.");
  });
  it("a locale with no listed country leaves the box empty and shows no hint", async () => {
    world.acceptLanguage = "en";
    const html = await render();
    expect(text(html)).not.toContain("Suggested from your browser");
    expect(html).not.toMatch(/<option[^>]*value="Nigeria"[^>]*selected/);
  });
});

describe("who is sent where", () => {
  it("signed out: to /login", async () => {
    world.session = null;
    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toMatch(/^\/login/);
  });
  it("an email sign-up (never asked): straight on to the destination", async () => {
    world.session = { user: { id: "e", app_metadata: { provider: "email" }, user_metadata: {} }, profile: { country: null } };
    await expect(render("/settings")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/settings");
  });
  it("a Google account that already has a country in its metadata: straight on", async () => {
    world.session = { user: google({ country: "Kenya" }), profile: { country: "Kenya" } };
    await expect(render("/dashboard")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/dashboard");
  });
  it("a Google account whose PROFILE already has a country (set in Settings): the sync route copies it and moves on, no form", async () => {
    world.session = { user: google(), profile: { first_name: "Agnes", country: "Ghana" } };
    await expect(render("/jobs/abc")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/welcome/country/sync?next=%2Fjobs%2Fabc");
  });
});
