/**
 * send-480 — /scholarships now branches on auth state, so its metadata must too, and
 * the branch must not touch the signed-in visitor's title (send-385's exact pattern for
 * /mentorship). `generateMetadata` is the one part of that branch a unit test can reach
 * without rendering the whole server page.
 *
 * Signed in: EXACTLY `{ title: "Scholarships — Talentrah" }` — deep-equal, not
 * "contains", because an added description or canonical would be a change to the
 * authenticated page's head, which this change promises not to make.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalUser = vi.fn();
vi.mock("@/lib/auth/require-user", () => ({
  getOptionalUser: () => getOptionalUser(),
  requireUser: vi.fn(),
}));

/**
 * Imported dynamically and narrowed, so this file typechecks both before the export exists
 * (the tests-first commit) and after it does.
 */
async function generateMetadata(): Promise<unknown> {
  const page = (await import("@/app/(app)/scholarships/(list)/page")) as { generateMetadata?: () => Promise<unknown> };
  return (page.generateMetadata as () => Promise<unknown>)();
}

beforeEach(() => getOptionalUser.mockReset());

describe("/scholarships generateMetadata", () => {
  it("leaves a signed-in visitor's metadata exactly as it always was", async () => {
    getOptionalUser.mockResolvedValue({ user: { id: "u1" }, profile: { id: "u1" } });
    expect(await generateMetadata()).toEqual({ title: "Scholarships — Talentrah" });
  });

  it("gives a signed-out visitor a real title, a description that fits a search result, and the canonical path", async () => {
    getOptionalUser.mockResolvedValue(null);
    const meta = (await generateMetadata()) as { title?: unknown; description?: string; alternates?: { canonical?: string } };
    expect(String(meta.title)).toContain("Scholarships for Nigerian & African Students");
    expect(String(meta.title)).not.toBe("Scholarships — Talentrah");
    expect(meta.description, "signed-out description").toBeTruthy();
    expect(meta.description!.length).toBeLessThanOrEqual(160);
    // Exact, not "ends with": the canonical is the bare path with NO query string. With the
    // /scholarships$ disallow gone, /scholarships?level=phd (and every other filter URL) serves
    // this same signed-out landing to crawlers, and this is what collapses them into one URL.
    expect(meta.alternates?.canonical).toBe("/scholarships");
    expect(String(meta.alternates?.canonical)).not.toContain("?");
  });

  it("does not vary with the query string: generateMetadata takes no searchParams at all", async () => {
    getOptionalUser.mockResolvedValue(null);
    const page = (await import("@/app/(app)/scholarships/(list)/page")) as { generateMetadata?: (...a: unknown[]) => Promise<unknown> };
    expect(page.generateMetadata!.length, "a metadata function that reads searchParams could emit per-filter canonicals").toBe(0);
  });

  it("treats a session with no profile row as signed out (getOptionalUser's documented degradation)", async () => {
    // getOptionalUser returns null in that state; this pins that the page follows it rather than throwing.
    getOptionalUser.mockResolvedValue(null);
    await expect(generateMetadata()).resolves.toBeTruthy();
  });
});
