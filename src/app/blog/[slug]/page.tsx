import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { notFound } from "next/navigation";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { getAllPosts, getPostBySlug } from "@/lib/blog/posts";
import { renderMarkdown } from "@/lib/blog/render";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

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
