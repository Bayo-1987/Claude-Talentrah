import { SITE_ORIGIN, SHARE_IMAGE_META, absoluteUrl } from "./site";
import type { BlogPost } from "@/lib/blog/posts";

/**
 * BlogPosting structured data for /blog/[slug].
 *
 * ── HOW THIS DIFFERS FROM THE JobPosting BUILDER, AND WHY ─────────────────
 *
 * job-posting-jsonld.ts is defensive to the point of emitting nothing at all,
 * because JobPosting has a REQUIRED set and a missing member is a Search
 * Console error against a page that looks fine to a human.
 *
 * Article/BlogPosting has no required set. Google's documentation, read rather
 * than recalled: "There are no required properties; instead, add the
 * properties that apply to your content." Everything below is Recommended.
 *
 * That removes the invalid-markup failure mode but not the dishonest-markup
 * one, and the second is the one worth guarding here. Every property is a
 * claim, and a wrong claim about freshness or authorship is worse than a
 * missing one — Google uses these dates as signals, and a site that asserts a
 * modification date it cannot support is manipulating a signal whether or not
 * it meant to. So: state what the database actually knows, omit the rest.
 *
 * ── WHY dateModified IS USUALLY ABSENT ────────────────────────────────────
 *
 * `blog_posts.updated_at` is NOT the same thing as "when this article was
 * last edited". Every row is inserted with `updated_at == created_at`, and
 * for the four posts 0074 migrated out of MDX that pair is the moment the
 * migration ran — 2026-08-31 11:52:50, all four identical, checked on
 * production rather than assumed. Passing the column through would have told
 * Google every post was freshly modified that day, when what changed was
 * where the bytes live.
 *
 * `BlogPost.updatedAt` is therefore null until something actually edits the
 * row, and this omits dateModified in that case. It will start appearing on
 * its own the first time a post is edited in /admin/blog.
 */

/** Only the fields this builder reads, so a caller can pass a richer object. */
type PostForJsonLd = Pick<BlogPost, "slug" | "title" | "description" | "date" | "author"> &
  Partial<Pick<BlogPost, "updatedAt">>;

export function buildBlogPostingJsonLd(post: PostForJsonLd): Record<string, unknown> | null {
  const headline = post.title?.trim();
  /*
   * A post with no title has nothing to identify it, and `headline` is the
   * one property every consumer of this markup keys on. Nothing else here is
   * load-bearing enough to justify withholding the whole block.
   */
  if (!headline) return null;

  const url = absoluteUrl(`/blog/${post.slug}`);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline,
    url,
    /*
     * mainEntityOfPage disambiguates which page this markup describes. It
     * matters for a blog because the same post is also summarised on /blog,
     * and without it the two can be read as competing descriptions.
     */
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: absoluteUrl(SHARE_IMAGE_META.url),
    publisher: {
      "@type": "Organization",
      name: "Talentrah",
      url: SITE_ORIGIN,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl(SHARE_IMAGE_META.url),
        width: SHARE_IMAGE_META.width,
        height: SHARE_IMAGE_META.height,
      },
    },
  };

  if (post.description?.trim()) jsonLd.description = post.description.trim();

  /*
   * Person, not Organization, and no `url`. Google recommends author.url to
   * disambiguate — but it wants a page that uniquely identifies the author,
   * and this site has no author pages. Pointing it at the homepage would
   * disambiguate nothing and assert a relationship that does not exist.
   */
  if (post.author?.trim()) {
    jsonLd.author = { "@type": "Person", name: post.author.trim() };
  }

  // ISO 8601 with timezone, per Google's stated format.
  if (post.date) {
    const published = new Date(post.date);
    if (!Number.isNaN(published.getTime())) jsonLd.datePublished = published.toISOString();
  }

  if (post.updatedAt) {
    const modified = new Date(post.updatedAt);
    /*
     * Never BEFORE datePublished. A post whose published_at was hand-set to a
     * date after the row was touched would otherwise emit a modification that
     * precedes publication, which is incoherent rather than merely imprecise.
     */
    if (
      !Number.isNaN(modified.getTime()) &&
      !(jsonLd.datePublished && modified.toISOString() < (jsonLd.datePublished as string))
    ) {
      jsonLd.dateModified = modified.toISOString();
    }
  }

  return jsonLd;
}
