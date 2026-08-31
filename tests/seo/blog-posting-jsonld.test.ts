/**
 * BlogPosting structured data.
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ─────────────────────────────────────────
 *
 * Unlike JobPosting, Article/BlogPosting has no required properties at all —
 * Google's own words, read from its Article documentation: "There are no
 * required properties; instead, add the properties that apply to your
 * content." So the failure this file guards is NOT invalid markup. It is
 * markup that asserts something the database does not know.
 *
 * The concrete instance, and the reason `dateModified` gets four tests: every
 * blog_posts row is inserted with `updated_at == created_at`, and for the four
 * posts 0074 migrated out of MDX that pair is the moment the migration ran —
 * 2026-08-31 11:52:50, identical across all four, checked on production. A
 * builder that passed `updated_at` through would have told Google all four
 * articles were freshly modified that day. Nothing would have failed, nothing
 * would have looked wrong, and the site would have been feeding a freshness
 * signal it could not support.
 */
import { describe, expect, it } from "vitest";
import { buildBlogPostingJsonLd } from "@/lib/seo/blog-posting-jsonld";

const base = (over: Record<string, unknown> = {}) => ({
  slug: "reading-your-match-score",
  title: "Reading your match score",
  description: "What the number means, and what it does not.",
  date: "2026-08-01T00:00:00.000Z",
  author: "Farah",
  updatedAt: null as string | null,
  ...over,
});

describe("dateModified is omitted unless something really edited the post", () => {
  it("omits it for a post that has never been edited", () => {
    const jsonLd = buildBlogPostingJsonLd(base({ updatedAt: null }))!;
    expect(jsonLd.datePublished).toBe("2026-08-01T00:00:00.000Z");
    expect(jsonLd).not.toHaveProperty("dateModified");
  });

  it("emits it once a post has been edited", () => {
    const jsonLd = buildBlogPostingJsonLd(
      base({ updatedAt: "2026-09-15T10:30:00.000Z" }),
    )!;
    expect(jsonLd.dateModified).toBe("2026-09-15T10:30:00.000Z");
  });

  it("never claims a modification that predates publication", () => {
    /*
     * Incoherent rather than merely imprecise, and reachable: published_at is
     * the post's own stated date and can be set to anything, including a date
     * after the row was last touched.
     */
    const jsonLd = buildBlogPostingJsonLd(
      base({ date: "2026-08-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }),
    )!;
    expect(jsonLd).not.toHaveProperty("dateModified");
  });

  it("ignores an unparseable timestamp rather than emitting Invalid Date", () => {
    const jsonLd = buildBlogPostingJsonLd(base({ updatedAt: "not a date" }))!;
    expect(jsonLd).not.toHaveProperty("dateModified");
  });
});

describe("the properties that are always safe to state", () => {
  it("names the article, its canonical page, and the publisher", () => {
    const jsonLd = buildBlogPostingJsonLd(base())!;
    expect(jsonLd["@type"]).toBe("BlogPosting");
    expect(jsonLd.headline).toBe("Reading your match score");
    expect(jsonLd.url).toContain("/blog/reading-your-match-score");
    expect((jsonLd.mainEntityOfPage as Record<string, string>)["@id"]).toBe(jsonLd.url);
    expect((jsonLd.publisher as Record<string, unknown>).name).toBe("Talentrah");
  });

  it("uses absolute URLs throughout — a relative one is worthless to a crawler", () => {
    const jsonLd = buildBlogPostingJsonLd(base())!;
    const publisher = jsonLd.publisher as Record<string, Record<string, string>>;
    for (const url of [jsonLd.url, jsonLd.image, publisher.logo.url]) {
      expect(String(url)).toMatch(/^https?:\/\//);
    }
  });

  it("attributes the author as a Person and asserts no author URL", () => {
    // Google recommends author.url, but wants a page that uniquely identifies
    // the author. This site has none, and pointing it at the homepage would
    // assert a relationship that does not exist.
    const author = buildBlogPostingJsonLd(base())!.author as Record<string, string>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe("Farah");
    expect(author).not.toHaveProperty("url");
  });

  it("emits nothing at all when there is no headline to identify the post", () => {
    expect(buildBlogPostingJsonLd(base({ title: "   " }))).toBeNull();
  });

  it("omits description rather than emitting an empty one", () => {
    const jsonLd = buildBlogPostingJsonLd(base({ description: "" }))!;
    expect(jsonLd).not.toHaveProperty("description");
  });
});
