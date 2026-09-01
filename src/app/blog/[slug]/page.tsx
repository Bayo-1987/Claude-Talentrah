import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { notFound } from "next/navigation";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { getAllPosts, getPostBySlug } from "@/lib/blog/posts";
import { renderMarkdown } from "@/lib/blog/render";
import { buildBlogPostingJsonLd } from "@/lib/seo/blog-posting-jsonld";
import { JsonLd } from "@/components/seo/json-ld";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * A BACKSTOP, not the mechanism.
 *
 * Publishing, unpublishing, editing and deleting all call `revalidatePath`
 * from their Server Actions, so the normal path is still instant and this
 * value never comes into it. What it fixes is the case where something
 * reaches `blog_posts` WITHOUT going through those actions — a migration, a
 * bulk tool, a script, a hand-run SQL statement.
 *
 * That is not hypothetical. A row deleted straight through the database
 * connector during the 0074 rollout left /blog/<slug> serving a cached 200
 * with `x-vercel-cache: HIT` and a climbing age, while the listing and the
 * sitemap — both of which query live — correctly showed it gone. Without a
 * time bound the page was stuck until a redeploy, and a redeploy is what it
 * took to clear it.
 *
 * An hour, because the cost of being wrong is asymmetric: an hour of a stale
 * blog post is a nuisance, an indefinitely stuck one is an incident that only
 * a deploy resolves. Short enough to self-heal unattended, long enough that it
 * is not doing the work `revalidatePath` already does well.
 */
export const revalidate = 3600;

/*
 * Still prerenders the published set, but the set now comes from the database
 * rather than from a directory listing. Anything published after a build is
 * rendered on demand instead of 404ing — `dynamicParams` defaults to true —
 * which is what makes publishing from /admin/blog take effect without a
 * deploy. That is the whole point of the move.
 */
export async function generateStaticParams() {
  return (await getAllPosts()).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  /*
   * `article`, and via pageMetadata so og:title carries the POST's title.
   * Before this it fell through to the root's generic "Talentrah", so every
   * shared post produced an identical card — the one place where the title
   * being right in the tab hid the tag being wrong.
   */
  return pageMetadata({
    title: `${post.title} — Talentrah Blog`,
    description: post.description,
    path: `/blog/${slug}`,
    type: "article",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  return (
    <>
      <JsonLd data={buildBlogPostingJsonLd(post)} />
      <MarketingMasthead />
      <div className="py-20">
        <Container className="flex max-w-[760px] flex-col gap-10">
          <div className="flex flex-col gap-4 border-b border-line pb-10">
            <EyebrowLabel>Blog</EyebrowLabel>
            <h1 className="text-[34px] leading-[1.25]">{post.title}</h1>
            <p className="text-[13.5px] text-ink-soft">
              {formatDate(post.date)} · {post.author}
            </p>
          </div>
          <div className="flex flex-col gap-6">
            {/*
              Markdown rendered to sanitised HTML, not compiled as MDX — see
              lib/blog/render.ts for why a database-sourced body must not be
              executable. `renderMarkdown` emits the same element classes
              mdxComponents did, so the migrated posts render unchanged.
            */}
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }} />
          </div>
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
