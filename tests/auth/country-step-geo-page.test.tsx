/**
 * COUNTRY-DEFAULT-GEO-1, the page and the form: which country is pre-selected, which hint shows, and that a person who already has a country is neither re-prompted nor overwritten.
 * Static render of the server page with its session and request headers stubbed (the same harness as country-step-page.test.tsx, which stays unchanged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const world = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown>; profile: Record<string, unknown> },
  headers: {} as Record<string, string>,
  redirectedTo: null as string | null,
  writes: [] as string[],
}));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), getOptionalUser: async () => world.session }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(world.headers) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    world.redirectedTo = to;
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth/google-country-actions", () => ({ saveGoogleCountryAction: async () => { world.writes.push("save"); return { status: "idle" }; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { world.writes.push("supabase"); throw new Error("rendering the step must not touch the database"); } }));

const { default: CountryStepPage } = await import("@/app/welcome/country/page");

const google = (meta: Record<string, unknown> = {}) => ({ id: "u1", app_metadata: { provider: "google" }, user_metadata: meta });
const render = async (next?: string) => renderToStaticMarkup(await CountryStepPage({ searchParams: Promise.resolve(next ? { next } : {}) }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const selected = (html: string, value: string) => new RegExp(`<option[^>]*value="${value}"[^>]*selected|<option[^>]*selected[^>]*value="${value}"`).test(html);

const LOCATION_HINT = "Suggested from your location. Change it if it's wrong.";
const BROWSER_HINT = "Suggested from your browser. Change it if it's wrong.";

beforeEach(() => {
  world.session = { user: google(), profile: { first_name: "Agnes", country: null } };
  world.headers = {};
  world.redirectedTo = null;
  world.writes = [];
});

describe("which country is pre-selected, and which hint shows", () => {
  it("an IP in Nigeria with an en-US browser pre-selects Nigeria and says 'from your location'", async () => {
    world.headers = { "x-vercel-ip-country": "NG", "accept-language": "en-US,en;q=0.9" };
    const html = await render();
    expect(selected(html, "Nigeria")).toBe(true);
    expect(selected(html, "United States")).toBe(false);
    expect(text(html)).toContain(LOCATION_HINT);
    expect(text(html)).not.toContain("Suggested from your browser");
  });
  it("no IP header: the browser language still decides, with the existing 'from your browser' hint", async () => {
    world.headers = { "accept-language": "en-NG,en;q=0.9" };
    const html = await render();
    expect(selected(html, "Nigeria")).toBe(true);
    expect(text(html)).toContain(BROWSER_HINT);
    expect(text(html)).not.toContain("from your location");
  });
  it("an IP that cannot be mapped falls back to the browser language", async () => {
    world.headers = { "x-vercel-ip-country": "XX", "accept-language": "en-GH" };
    const html = await render();
    expect(selected(html, "Ghana")).toBe(true);
    expect(text(html)).toContain(BROWSER_HINT);
  });
  it("neither: an empty box and no hint at all", async () => {
    world.headers = { "x-vercel-ip-country": "T1", "accept-language": "en" };
    const html = await render();
    expect(text(html)).not.toContain("Suggested from");
    expect(html).not.toMatch(/<option[^>]*value="[A-Za-z][^"]*"[^>]*selected/);
  });
  it("the select stays an ordinary, changeable select with the whole list; rendering saves nothing", async () => {
    world.headers = { "x-vercel-ip-country": "GB" };
    const html = await render();
    expect(html).toMatch(/<select[^>]*name="country"/);
    expect(html).not.toMatch(/<select[^>]*(disabled|readonly)/i);
    expect((html.match(/<option/g) ?? []).length).toBeGreaterThan(200);
    expect(world.writes).toEqual([]);
  });
});

describe("a person who already has a country is not re-prompted and not overwritten", () => {
  it("a Google account whose profile has a country goes to the sync route, whatever the IP says", async () => {
    world.session = { user: google(), profile: { first_name: "Agnes", country: "Ghana" } };
    world.headers = { "x-vercel-ip-country": "US", "accept-language": "en-US" };
    await expect(render("/jobs")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/welcome/country/sync?next=%2Fjobs");
    expect(world.writes).toEqual([]);
  });
  it("a Google account whose metadata already has a country, and an email sign-up, go straight on", async () => {
    world.session = { user: google({ country: "Kenya" }), profile: { country: "Kenya" } };
    world.headers = { "x-vercel-ip-country": "US" };
    await expect(render("/dashboard")).rejects.toThrow("NEXT_REDIRECT");
    expect(world.redirectedTo).toBe("/dashboard");
  });
});

describe("not cached across visitors", () => {
  it("the page declares no static or cached rendering and no public cache header (it reads the request's headers and session)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(join(__dirname, "../../src/app/welcome/country/page.tsx"), "utf8");
    expect(page).not.toMatch(/export const (dynamic|revalidate|fetchCache)\b/);
    expect(page).toContain("await headers()");
    const config = readFileSync(join(__dirname, "../../next.config.ts"), "utf8");
    expect(config).not.toMatch(/welcome/);
  });
});
