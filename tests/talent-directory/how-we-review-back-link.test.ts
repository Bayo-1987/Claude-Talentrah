/**
 * HWR-1 (owner's live UX bug): /how-we-review-resumes had no way back. Every link to it now carries `?from=<the page the person came from>`, and the page shows
 * "← Back to <label>" from a short allow-list.
 *
 * The rules pinned here (pure functions, no browser):
 *   - `from` is a PATH only, and only an exact entry of the allow-list: the Talent Directory list, the employer's Jobs Posted, and the seeker's resume-review page. It never
 *     carries an id or any personal data: the candidate page and the applicants page are NOT in the map (their paths hold a candidate id or a job id), so they link with their
 *     parent list's path.
 *   - Anything else gives NO link: "//host", "http:", "https:", "javascript:", a backslash variant, an id path, a path with a query or fragment, a different case, padding,
 *     a non-string, nothing at all. Validated with the repo's own safe-redirect helper first, then by exact membership.
 * Reached through loadModule so the file compiles before the module exists.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  HOW_WE_REVIEW_BACK_TARGETS?: Readonly<Record<string, string>>;
  howWeReviewHref?: (from?: string | null) => string;
  backLinkFor?: (raw: unknown) => { href: string; label: string } | null;
}
async function mod() {
  return loadModule<Mod>("@/lib/talent-directory/how-we-review-link");
}
async function fn<K extends "howWeReviewHref" | "backLinkFor">(name: K): Promise<NonNullable<Mod[K]>> {
  const m = await mod();
  const f = m[name];
  if (!f) throw new Error(`how-we-review-link.ts does not export ${name}`);
  return f as NonNullable<Mod[K]>;
}

const BASE = "/how-we-review-resumes";
const ALLOWED: Array<[string, string]> = [
  ["/employer/talent-directory", "Talent Directory"],
  ["/employer/jobs", "Jobs Posted"],
  ["/talent-directory/verify", "your resume review"],
];

describe("the allow-list", () => {
  it("is exactly the three pages the owner named, with their labels", async () => {
    const m = await mod();
    expect(Object.entries(m.HOW_WE_REVIEW_BACK_TARGETS ?? {}).sort()).toEqual([...ALLOWED].sort());
  });
  it("holds only id-free paths: no id-shaped segment, no query, no fragment", async () => {
    const m = await mod();
    for (const p of Object.keys(m.HOW_WE_REVIEW_BACK_TARGETS ?? {})) {
      expect(p, p).toMatch(/^\/[a-z-]+(\/[a-z-]+)*$/);
      expect(p).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\d/);
    }
  });
  it("names only pages that exist in the app", async () => {
    const m = await mod();
    const pages: Record<string, string> = {
      "/employer/talent-directory": "src/app/employer/talent-directory/page.tsx",
      "/employer/jobs": "src/app/employer/jobs/page.tsx",
      "/talent-directory/verify": "src/app/(app)/talent-directory/verify/page.tsx",
    };
    for (const p of Object.keys(m.HOW_WE_REVIEW_BACK_TARGETS ?? {})) expect(existsSync(path.join(__dirname, "../..", pages[p])), p).toBe(true);
  });
});

describe("howWeReviewHref: the link every entry point uses", () => {
  it.each(ALLOWED)("from %s carries the encoded path and nothing else", async (from) => {
    const f = await fn("howWeReviewHref");
    expect(f(from)).toBe(`${BASE}?from=${encodeURIComponent(from)}`);
  });
  it.each([undefined, null, "", "//evil.example", "https://evil.example", "javascript:alert(1)", "/employer/talent-directory/123e4567-e89b-12d3-a456-426614174000", "/somewhere-else"])(
    "from %j is not carried: the plain page, no query",
    async (from) => {
      const f = await fn("howWeReviewHref");
      expect(f(from as string | null | undefined)).toBe(BASE);
    },
  );
});

describe("the repo's safe-redirect helper is part of the check (defence in depth under the exact allow-list match)", () => {
  it("how-we-review-link.ts imports safeRedirectTo from the auth module and runs every candidate through it before the lookup", () => {
    const src = readFileSync(path.join(__dirname, "../../src/lib/talent-directory/how-we-review-link.ts"), "utf8");
    expect(src).toMatch(/import \{ safeRedirectTo \} from "@\/lib\/auth\/redirect-to";/);
    const body = src.slice(src.indexOf("export function backLinkFor"));
    expect(body.indexOf("safeRedirectTo(")).toBeGreaterThan(-1);
    expect(body.indexOf("safeRedirectTo(")).toBeLessThan(body.indexOf("hasOwn("));
  });
  it.each(["/__proto__", "/constructor", "/toString", "/hasOwnProperty"])("the inherited-property name %s is no match", async (raw) => {
    const f = await fn("backLinkFor");
    expect(f(raw)).toBeNull();
  });
});

describe("backLinkFor: the page's side", () => {
  it.each(ALLOWED)("%s gives a link to that same path with its label", async (from, label) => {
    const f = await fn("backLinkFor");
    expect(f(from)).toEqual({ href: from, label });
  });

  it.each([
    "//evil.example",
    "//evil.example/employer/talent-directory",
    "http://evil.example",
    "https://evil.example/employer/talent-directory",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,x",
    "/\\evil.example",
    "\\\\evil.example",
    "",
    " ",
    " /employer/talent-directory",
    "/employer/talent-directory ",
    "/employer/talent-directory/",
    "/employer/talent-directory?x=1",
    "/employer/talent-directory#top",
    "/employer/talent-directory/123e4567-e89b-12d3-a456-426614174000",
    "/employer/jobs/123e4567-e89b-12d3-a456-426614174000/applicants",
    "/employer/jobs/../talent-directory",
    "/EMPLOYER/TALENT-DIRECTORY",
    "%2F%2Fevil.example",
    "/%2Fevil.example",
    "/employer/talent-directory%0d%0a",
    "/login",
    "/admin",
    "employer/talent-directory",
  ])("%j gives no link", async (raw) => {
    const f = await fn("backLinkFor");
    expect(f(raw)).toBeNull();
  });

  it.each([null, undefined, 0, 42, true, {}, [], ["/employer/talent-directory"], () => "/employer/talent-directory"])("a non-string (%s) gives no link", async (raw) => {
    const f = await fn("backLinkFor");
    expect(f(raw)).toBeNull();
  });
});
