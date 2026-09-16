import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/blog/posts";
import { OG_CONTENT_TYPE, OG_IMAGE_SIZE, renderOgCard } from "@/lib/seo/og-card";

/**
 * The share card for one blog post.
 *
 * `getPostBySlug` is the same loader the page and generateMetadata use, and it
 * only ever returns PUBLISHED rows (its own module header explains the two
 * independent guards). So a draft, an unpublished post and a deleted one all
 * 404 here exactly as they do on the page — a share card is not a way around
 * `status = 'published'`.
 *
 * The post's own `description` is the supporting line. It is already written
 * to be a meta description (~155 chars), so the card clamps it rather than
 * inventing a shorter summary.
 */
export const alt = "Talentrah blog post";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  return renderOgCard({
    eyebrow: "Talentrah blog",
    headline: post.title,
    supporting: post.description,
  });
}
