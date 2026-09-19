import { describe, it, expect } from "vitest";
import { STATIC_PATHS } from "@/app/sitemap";

/**
 * Regression guard for a specific merge-conflict shape: two branches each
 * added one entry to STATIC_PATHS (send-385's /mentorship, send-387's
 * /scholarships/apply-now), and a mechanical conflict resolution that picks
 * one side instead of keeping both would silently drop a real, indexable
 * page from the sitemap with no build or type error to catch it.
 */
describe("sitemap STATIC_PATHS", () => {
  it("includes every hand-authored public page currently known to be live", () => {
    const paths = STATIC_PATHS.map((p) => p.path);
    for (const expected of ["/", "/about", "/contact", "/blog", "/mentorship", "/scholarships/apply-now", "/legal/privacy", "/legal/terms", "/legal/data-cookie-notice"]) {
      expect(paths, `missing ${expected}`).toContain(expected);
    }
  });

  it("has no duplicate paths", () => {
    const paths = STATIC_PATHS.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
