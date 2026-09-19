import { getAllPosts, type BlogPostMeta } from "@/lib/blog/posts";

/**
 * send-387 Part 1 — the six scholarship deep-dive posts the hub page links
 * to, resolved by a distinctive keyword in each post's own title, NEVER by
 * a hardcoded slug. `blog_posts` has no category/tag column at all (checked
 * the schema first) — matching by title keyword is the same "curated,
 * reviewed list" precedent CITY_LANDING_PAGES (landing-pages.ts) already
 * establishes for a similar "no formal way to discover the right rows"
 * situation, rather than inventing a taxonomy column for six rows.
 *
 * Confirmed against production 2026-09-19: all six real, published, current
 * slugs are ptdf-overseas-scholarship-nigeria,
 * mastercard-foundation-scholars-program, rhodes-scholarship-west-africa,
 * chevening-scholarships-2027, trudeau-foundation-doctoral-scholarship,
 * gates-cambridge-scholarship-2027 — but none of those strings appear
 * anywhere in this file. If a post is ever renamed, this still finds it by
 * title; if a post is ever removed or renamed past recognition, it silently
 * drops out of the hub (`.filter()` below) rather than linking to a 404 —
 * the same "only claim what's actually live" discipline sitemap.ts and
 * every programmatic landing page in this codebase already holds itself to.
 */
const SCHOLARSHIP_HUB_TITLE_KEYWORDS = [
  "ptdf",
  "mastercard foundation",
  "rhodes scholarship",
  "chevening",
  "trudeau",
  "gates cambridge",
];

export async function loadScholarshipHubPosts(): Promise<BlogPostMeta[]> {
  const posts = await getAllPosts();
  return SCHOLARSHIP_HUB_TITLE_KEYWORDS.map((keyword) =>
    posts.find((post) => post.title.toLowerCase().includes(keyword)),
  ).filter((post): post is BlogPostMeta => post !== undefined);
}
