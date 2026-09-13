import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import Link from "next/link";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { getAllPosts } from "@/lib/blog/posts";

export const metadata: Metadata = pageMetadata({
  title: "Blog — Talentrah",
  description: "Career advice from the Talentrah team.",
  path: "/blog",
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

export default async function BlogIndexPage() {
  const posts = await getAllPosts();

  return (
    <>
      <MarketingMasthead />
      <div className="py-20">
        <Container className="flex max-w-[760px] flex-col gap-12">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>Blog</EyebrowLabel>
            <h1 className="text-[36px] leading-[1.2]">Career advice, from the team behind Farah.</h1>
          </div>

          {posts.length === 0 ? (
            <p className="text-[15px] text-ink-soft">
              Nothing published yet — check back soon.
            </p>
          ) : (
            <div className="flex flex-col border-t border-line">
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="flex flex-col gap-2 border-b border-line py-7 no-underline hover:text-rust"
                >
                  <span className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    {formatDate(post.date)}
                  </span>
                  <h2 className="text-[21px] text-ink">{post.title}</h2>
                  <p className="text-[15px] text-ink-soft">{post.description}</p>
                </Link>
              ))}
            </div>
          )}
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
