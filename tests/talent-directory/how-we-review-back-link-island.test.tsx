/**
 * HWR-1: the page's side. A small client island reads `from` and shows "← Back to <label>" only for an allow-listed path; the page itself stays STATIC (no `searchParams`
 * prop, no cookies or headers), so it is cached and fast for signed-out visitors and crawlers, and the island adds the link once the browser has the query string.
 * With no `from`, or a hostile one, there is no link at all.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadModule } from "../support/load-module";

let currentFrom: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "from" ? currentFrom : null) }),
}));

interface Island {
  HowWeReviewBackLink?: () => ReturnType<() => unknown>;
}
async function render(from: string | null) {
  currentFrom = from;
  const m = await loadModule<Island>("@/components/talent-directory/how-we-review-back-link");
  if (!m.HowWeReviewBackLink) throw new Error("how-we-review-back-link.tsx does not export HowWeReviewBackLink");
  const Comp = m.HowWeReviewBackLink as unknown as () => React.ReactNode;
  return renderToStaticMarkup(<>{Comp()}</>);
}
const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");

describe("the back link", () => {
  it.each([
    ["/employer/talent-directory", "Talent Directory"],
    ["/employer/jobs", "Jobs Posted"],
    ["/talent-directory/verify", "Talent Directory"],
  ])("from %s: '← Back to %s', a link to that path, at least 44px tall", async (from, label) => {
    const html = await render(from);
    expect(html).toMatch(new RegExp(`<a [^>]*href="${from.replace(/\//g, "\\/")}"[^>]*>`));
    expect(html.replace(/<[^>]+>/g, "")).toBe(`← Back to ${label}`);
    expect(html).toMatch(/\bmin-h-11\b/);
  });

  it.each([null, "", "//evil.example", "http://evil.example", "javascript:alert(1)", "/employer/talent-directory/123e4567-e89b-12d3-a456-426614174000", "/login"])(
    "from %j: no link at all",
    async (from) => {
      const html = await render(from);
      expect(html).not.toMatch(/<a[\s>]/);
      expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
    },
  );
});

describe("the page stays static and uses the island inside Suspense", () => {
  const page = read("src/app/how-we-review-resumes/page.tsx");
  it("mounts the island in a Suspense boundary (a static page may not read the query string outside one)", () => {
    expect(page).toMatch(/<Suspense[^>]*>\s*<HowWeReviewBackLink \/>\s*<\/Suspense>/);
  });
  it("takes no searchParams and reads no request data, so it is not made dynamic", () => {
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/searchParams/);
    expect(code).not.toMatch(/\b(cookies|headers)\(/);
    expect(code).not.toMatch(/export const dynamic/);
  });
  it("the island is a client component", () => {
    expect(read("src/components/talent-directory/how-we-review-back-link.tsx").trimStart()).toMatch(/^"use client"/);
  });
});
