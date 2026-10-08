/**
 * Refer & Earn (send-515): /refer branches on auth state, so its metadata must too, without touching the signed-in visitor's title
 * (send-480/484's pattern); and its loading placeholder is neutral for both visitors (no heading, no signed-in copy) so a streamed
 * fallback can never add a second <h1> to the raw response.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import ReferLoading from "@/app/(app)/refer/loading";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

const getOptionalUser = vi.fn();
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), getOptionalUser: () => getOptionalUser(), requireUser: vi.fn() }));

type Meta = { title?: unknown; description?: string; alternates?: { canonical?: string } };
async function pageModule() {
  return (await import("@/app/(app)/refer/page")) as { metadata?: Meta; generateMetadata?: (...a: unknown[]) => Promise<Meta>; dynamic?: string };
}

beforeEach(() => getOptionalUser.mockReset());

describe("/refer generateMetadata", () => {
  it("leaves a signed-in visitor's metadata exactly as it always was", async () => {
    getOptionalUser.mockResolvedValue({ user: { id: "u1" }, profile: { id: "u1" } });
    const page = await pageModule();
    const meta = page.generateMetadata ? await page.generateMetadata() : page.metadata!;
    expect(meta).toEqual({ title: "Refer a Friend — Talentrah" });
  });

  it("gives a signed-out visitor a real title, a description that fits a search result, and the bare canonical", async () => {
    getOptionalUser.mockResolvedValue(null);
    const page = await pageModule();
    expect(page.generateMetadata, "no generateMetadata export").toBeTypeOf("function");
    const meta = await page.generateMetadata!();
    expect(String(meta.title)).toContain("Refer");
    expect(String(meta.title)).not.toBe("Refer a Friend — Talentrah");
    expect(meta.description).toBeTruthy();
    expect(meta.description!.length).toBeLessThanOrEqual(160);
    expect(meta.alternates?.canonical).toBe("/refer");
    expect(String(meta.alternates?.canonical)).not.toContain("?");
    expect(String(meta.title) + meta.description).not.toMatch(/nigeria/i);
  });

  it("takes no searchParams (so no per-query canonical) and exports no static `metadata` shadowing generateMetadata", async () => {
    const page = (await pageModule()) as Record<string, unknown>;
    expect((page.generateMetadata as (...a: unknown[]) => unknown).length).toBe(0);
    expect(page.metadata).toBeUndefined();
  });
});

describe("/refer renders dynamically (a signed-out landing page and a signed-in page share one URL)", () => {
  it("the page reads the session, which makes it dynamic; nothing opts it into static rendering", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/(app)/refer/page.tsx"), "utf8");
    expect(src).toMatch(/getOptionalUser/);
    expect(src).not.toMatch(/export const dynamic\s*=\s*["']force-static["']/);
    expect(src).not.toMatch(/export const revalidate/);
  });

  it("the signed-out branch returns before ANY leaderboard call (anon has no execute on referral_leaderboard after 0211)", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/(app)/refer/page.tsx"), "utf8");
    const landing = src.indexOf("<ReferPublicLanding");
    const firstRpc = src.indexOf('.rpc("referral_leaderboard"');
    expect(landing, "the page does not render the public landing").toBeGreaterThan(-1);
    expect(firstRpc, "control: the signed-in page still reads the leaderboard").toBeGreaterThan(-1);
    expect(landing).toBeLessThan(firstRpc);
    expect(src.indexOf("requireUser()")).toBeGreaterThan(landing);
  });
});

describe("refer loading.tsx", () => {
  const html = renderToStaticMarkup(<ReferLoading />);

  it("still announces loading through the shared SkeletonStatus", () => {
    expect(html).toContain(`data-testid="${ROUTE_LOADING_TESTID}"`);
    expect(html).toContain('role="status"');
  });

  it("carries no heading at all, so it can never add a second <h1> to the raw response", () => {
    expect(html).not.toMatch(/<h[1-6][\s>]/);
  });

  it("is neutral: it names neither a link nor a signed-in state", () => {
    expect(html).not.toContain("Loading your referral link");
    expect(html).toContain("Refer &amp; earn");
  });
});
