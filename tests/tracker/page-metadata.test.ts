/**
 * send-484 — /tracker now branches on auth state, so its metadata must too, and the branch must not touch
 * the signed-in visitor's title (send-480's /scholarships test, same pattern).
 *
 * Signed in: EXACTLY `{ title: "Job Tracker — Talentrah" }` — deep-equal, not "contains", because an added
 * description or canonical would be a change to the authenticated page's head.
 *
 * Signed out: no "Nigeria" in the title or the description. The audience is going global, and the page
 * only ever claims what its own rows show.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalUser = vi.fn();
vi.mock("@/lib/auth/require-user", () => ({
  getOptionalUser: () => getOptionalUser(),
  requireUser: vi.fn(),
}));

type Meta = { title?: unknown; description?: string; alternates?: { canonical?: string } };

/** Narrowed dynamic import: typechecks both before the export exists (tests-first) and after. */
async function pageModule() {
  return (await import("@/app/(app)/tracker/page")) as { metadata?: Meta; generateMetadata?: (...a: unknown[]) => Promise<Meta> };
}
async function generateMetadata(): Promise<Meta> {
  return (await pageModule()).generateMetadata!();
}
/**
 * The head a signed-in visitor gets, whichever way the page declares it: today a static `metadata`
 * export, after this change `generateMetadata()`. Reading both makes the signed-in assertion a
 * characterisation — it passes on the code as it stood and must pass identically after.
 */
async function signedInMetadata(): Promise<Meta> {
  const page = await pageModule();
  return page.generateMetadata ? page.generateMetadata() : page.metadata!;
}

beforeEach(() => getOptionalUser.mockReset());

describe("/tracker generateMetadata", () => {
  it("leaves a signed-in visitor's metadata exactly as it always was", async () => {
    getOptionalUser.mockResolvedValue({ user: { id: "u1" }, profile: { id: "u1" } });
    expect(await signedInMetadata()).toEqual({ title: "Job Tracker — Talentrah" });
  });

  it("gives a signed-out visitor a real title, a description that fits a search result, and the bare canonical", async () => {
    getOptionalUser.mockResolvedValue(null);
    const meta = await generateMetadata();
    expect(String(meta.title)).toContain("Job Tracker");
    expect(String(meta.title)).not.toBe("Job Tracker — Talentrah");
    expect(meta.description, "signed-out description").toBeTruthy();
    expect(meta.description!.length).toBeLessThanOrEqual(160);
    // Exact: the canonical is the bare path with NO query string, so every /tracker?stage=…&sort=… variant a
    // crawler finds collapses into one URL.
    expect(meta.alternates?.canonical).toBe("/tracker");
    expect(String(meta.alternates?.canonical)).not.toContain("?");
  });

  it("never says 'Nigeria' in the signed-out title or description", async () => {
    getOptionalUser.mockResolvedValue(null);
    const meta = await generateMetadata();
    expect(String(meta.title)).not.toMatch(/nigeria/i);
    expect(meta.description).not.toMatch(/nigeria/i);
  });

  it("does not vary with the query string: generateMetadata takes no searchParams at all", async () => {
    getOptionalUser.mockResolvedValue(null);
    const page = await pageModule();
    expect(page.generateMetadata, "no generateMetadata export").toBeTypeOf("function");
    expect(page.generateMetadata!.length, "a metadata function that reads searchParams could emit per-filter canonicals").toBe(0);
  });

  it("treats a session with no profile row as signed out (getOptionalUser's documented degradation)", async () => {
    getOptionalUser.mockResolvedValue(null);
    await expect(generateMetadata()).resolves.toBeTruthy();
  });

  it("no longer exports a static `metadata` that would shadow generateMetadata", async () => {
    const page = (await pageModule()) as Record<string, unknown>;
    expect(page.metadata).toBeUndefined();
  });
});
