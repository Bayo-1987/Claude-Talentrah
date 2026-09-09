/**
 * send-119 added `freeOnly` as a fourth filter on the template gallery
 * (`category`, `q`, `atsSafe` already existed). `buildGalleryHref` is what
 * every filter link and pagination link on that page goes through — get
 * the base/changes merge wrong and one filter silently drops another the
 * instant a new one is added, which is exactly the failure mode worth
 * pinning directly rather than trusting from reading the page.
 */
import { describe, expect, it } from "vitest";
import { buildGalleryHref } from "@/lib/resume-builder/gallery-href";

describe("buildGalleryHref", () => {
  it("toggling freeOnly on preserves an active category and search term — the intersection, not an override", () => {
    const base = { category: "Engineering", q: "modern", atsSafe: undefined, freeOnly: undefined };
    const href = buildGalleryHref(base, { freeOnly: "1", page: undefined });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("category")).toBe("Engineering");
    expect(params.get("q")).toBe("modern");
    expect(params.get("freeOnly")).toBe("1");
  });

  it("toggling category on preserves an active freeOnly filter", () => {
    const base = { category: undefined, q: undefined, atsSafe: undefined, freeOnly: "1" };
    const href = buildGalleryHref(base, { category: "Design", page: undefined });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("category")).toBe("Design");
    expect(params.get("freeOnly")).toBe("1");
  });

  it("all four filters compose together at once — atsSafe and freeOnly don't override each other", () => {
    const base = { category: "Design", q: "clean", atsSafe: "1", freeOnly: "1" };
    const href = buildGalleryHref(base, { page: "2" });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("category")).toBe("Design");
    expect(params.get("q")).toBe("clean");
    expect(params.get("atsSafe")).toBe("1");
    expect(params.get("freeOnly")).toBe("1");
    expect(params.get("page")).toBe("2");
  });

  it("turning freeOnly off removes ONLY freeOnly from the URL, nothing else", () => {
    const base = { category: "Design", q: "clean", atsSafe: "1", freeOnly: "1" };
    const href = buildGalleryHref(base, { freeOnly: undefined, page: undefined });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.has("freeOnly")).toBe(false);
    expect(params.get("category")).toBe("Design");
    expect(params.get("q")).toBe("clean");
    expect(params.get("atsSafe")).toBe("1");
  });

  it("returns the bare path with no filters active at all", () => {
    expect(buildGalleryHref({}, {})).toBe("/resume-builder");
  });
});
