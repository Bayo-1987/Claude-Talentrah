/**
 * Every producer of a return path, fed realistic inputs: what each one builds must come back out of safeRedirectTo UNCHANGED. The rule exists to refuse
 * hostile values, and it must never refuse a path the app itself builds (that would silently drop the visitor's way back to the page they were on).
 *
 * Producers: returnPathFor, authLinkWithReturn, onboardingDestination, destinationAfterStep, the path header the proxy stamps (updateSession), the proxy's
 * signed-out gate (/login?redirectTo=) and the country-step gate (/welcome/country?next=).
 *
 * "Realistic" means what the browser and Next actually hand over: `window.location.search` and `request.nextUrl.search` are serialised by the URL parser, so a
 * typed space arrives as %20 and a non-ASCII letter as %XX; each address below is therefore run through `new URL()` first, exactly as they are.
 * No database; the Supabase client is stubbed.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> } | null;
const h = vi.hoisted(() => ({ user: null as unknown as U }));

vi.mock("@supabase/ssr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/ssr")>()),
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));
vi.mock("@/lib/supabase/public-read", () => ({ createPublicReadClient: () => ({ rpc: async () => ({ data: false, error: null }) }) }));

import { authLinkWithReturn, onboardingDestination, PATH_HEADER, returnPathFor, safeRedirectTo } from "@/lib/auth/redirect-to";
import { destinationAfterStep } from "@/lib/auth/country-step-destination";
import { updateSession } from "@/lib/supabase/middleware";
import { proxy } from "@/proxy";

const BASE = "https://www.talentrah.com";
const LONG_QUERY = `?q=${"a".repeat(1_992)}`;

/** [label, address as typed or linked]. The pages are ones with something to come back to (not "/" or the auth screens, which return "" by design). */
const ADDRESSES: ReadonlyArray<readonly [string, string]> = [
  ["a plain path", "/scholarships/abc-123"],
  ["a query with a space", "/jobs?q=data engineer"],
  ["a plus", "/jobs?q=c++&level=a+b"],
  ["a percent-encoded space and slash", "/jobs?q=data%20engineer&back=%2Fjobs%2Fremote"],
  ["an ampersand", "/jobs?q=a&country=ng&page=2"],
  ["a hash fragment", "/jobs?q=x#top"],
  ["a non-ASCII query", "/jobs?q=café"],
  ["a very long but legitimate query (2,000 characters)", `/jobs${LONG_QUERY}`],
  ["a trailing slash", "/jobs/"],
  ["a trailing slash with a query", "/mentorship/?topic=interview"],
];

/** What the browser / Next hand to the producers for an address. */
const seen = (address: string) => {
  const u = new URL(address, BASE);
  return { pathname: u.pathname, search: u.search, full: u.pathname + u.search };
};

const nextParam = (location: string, name: string) => new URL(location, BASE).searchParams.get(name);

describe("round trip: what each producer builds passes safeRedirectTo unchanged", () => {
  it.each(ADDRESSES)("returnPathFor: %s", (_n, address) => {
    const { pathname, search, full } = seen(address);
    const out = returnPathFor(pathname, search);
    expect(out).toBe(full);
    expect(safeRedirectTo(out, "FALLBACK")).toBe(out);
  });

  it.each(ADDRESSES)("authLinkWithReturn (login and signup): %s", (_n, address) => {
    const { pathname, search, full } = seen(address);
    for (const base of ["/login", "/signup"] as const) {
      const link = authLinkWithReturn(base, pathname, search);
      const carried = nextParam(link, "redirectTo");
      expect(carried).toBe(full);
      expect(safeRedirectTo(carried, "FALLBACK")).toBe(full);
    }
  });

  it.each(ADDRESSES)("onboardingDestination: %s", (_n, address) => {
    const { full } = seen(address);
    const carried = nextParam(onboardingDestination(full), "next");
    expect(carried).toBe(full);
    expect(safeRedirectTo(carried, "FALLBACK")).toBe(full);
  });

  it.each(ADDRESSES)("destinationAfterStep: %s", (_n, address) => {
    const { full } = seen(address);
    expect(destinationAfterStep(full)).toBe(full);
  });

  it.each(ADDRESSES)("the path header the proxy stamps (updateSession): %s", async (_n, address) => {
    h.user = null;
    const request = new NextRequest(new URL(address, BASE));
    await updateSession(request);
    const stamped = request.headers.get(PATH_HEADER);
    expect(stamped).toBe(seen(address).full);
    expect(safeRedirectTo(stamped, "FALLBACK")).toBe(stamped);
  });

  it("the front door and the auth screens have nothing to come back to: the producers return the empty value by design, not by refusal", () => {
    expect(returnPathFor("/", "")).toBe("");
    expect(returnPathFor("/login", "?redirectTo=%2Fjobs")).toBe("");
    expect(authLinkWithReturn("/login", "/", "")).toBe("/login");
    // and the rule itself accepts the root
    expect(safeRedirectTo("/", "FALLBACK")).toBe("/");
  });
});

describe("round trip through the real proxy gates", () => {
  const run = (address: string) => proxy(new NextRequest(new URL(address, BASE)), { waitUntil: vi.fn() } as never);
  beforeEach(() => {
    h.user = null;
  });

  // Protected seeker pages (signed-out gate): /billing and /tailor.
  const PROTECTED: ReadonlyArray<readonly [string, string]> = [
    ["a plain path", "/billing"],
    ["a query with a space", "/tailor?q=data engineer"],
    ["a plus", "/tailor?q=c++"],
    ["a percent-encoded space and slash", "/tailor?q=data%20engineer&back=%2Fjobs"],
    ["an ampersand", "/tailor?a=1&b=2"],
    ["a hash fragment", "/tailor?q=x#top"],
    ["a non-ASCII query", "/tailor?q=café"],
    ["a very long but legitimate query", `/tailor${LONG_QUERY}`],
    ["a trailing slash", "/billing/"],
  ];

  it.each(PROTECTED)("signed-out gate -> /login?redirectTo=: %s", async (_n, address) => {
    const response = await run(address);
    expect(response.status).toBeGreaterThanOrEqual(300);
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname.replace(/\/$/, "")).toBe("/login");
    const carried = nextParam(location, "redirectTo");
    expect(carried).toBe(seen(address).full);
    expect(safeRedirectTo(carried, "FALLBACK")).toBe(carried);
  });

  it.each(ADDRESSES)("country-step gate -> /welcome/country?next=: %s", async (_n, address) => {
    h.user = { id: "g1", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: {} };
    const response = await run(address);
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname.replace(/\/$/, "")).toBe("/welcome/country");
    const carried = nextParam(location, "next");
    expect(carried).toBe(seen(address).full);
    expect(safeRedirectTo(carried, "FALLBACK")).toBe(carried);
  });
});
