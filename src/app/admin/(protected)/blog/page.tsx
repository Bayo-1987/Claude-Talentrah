import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { listAllPosts } from "@/lib/admin/blog/posts";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

export const metadata = {
  title: "Blog — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Every post, drafts and published together.
 *
 * NOT A QUEUE — like the course catalog and unlike the moderation screens.
 * There is no "done" state to clear towards; this is the whole corpus, and a
 * draft sitting here indefinitely is a normal thing rather than a backlog.
 *
 * Status is carried by a WORD and a rule, not by colour alone. The three match
 * tiers own green/rust/amber in this design system, and a coloured pill here
 * would read as a fourth one; it also would not survive being printed or being
 * looked at by someone who does not distinguish those hues.
 */
export default async function AdminBlogPage() {
  await requirePermission("blog");
  const posts = await listAllPosts();
  const drafts = posts.filter((p) => p.status === "draft").length;
  const published = posts.length - drafts;

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <EyebrowLabel>Blog</EyebrowLabel>
          <h1 className="mt-2 font-display text-[26px]">Posts</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {published} published · {drafts} draft{drafts === 1 ? "" : "s"}. Publishing takes effect
            immediately — there is no deploy in the loop.
          </p>
        </div>
        <Link href="/admin/blog/new" className={buttonClasses("primary", "sm", "no-underline")}>
          New post
        </Link>
      </div>

      {posts.length === 0 ? (
        <BorderedCard className="p-6 text-[14px] text-ink-soft">
          No posts yet. <Link href="/admin/blog/new" className="underline">Write the first one.</Link>
        </BorderedCard>
      ) : (
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {posts.map((post) => (
            <div key={post.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  {/*
                    A bordered word, not a coloured dot: it reads the same in
                    every light and says which state it is rather than relying
                    on the reader remembering what a colour meant.
                  */}
                  <span
                    className={
                      post.status === "published"
                        ? "border border-ink px-1.5 py-0.5 font-body text-[10.5px] font-bold tracking-[0.1em] uppercase"
                        : "border border-line px-1.5 py-0.5 font-body text-[10.5px] font-bold tracking-[0.1em] text-ink-soft uppercase"
                    }
                  >
                    {post.status}
                  </span>
                  <span className="truncate font-body text-[14.5px] font-semibold">{post.title}</span>
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-ink-soft">
                  /blog/{post.slug} · updated {new Date(post.updated_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-4">
                {post.status === "published" && (
                  <a
                    href={`/blog/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-ink-soft underline underline-offset-2"
                  >
                    View
                  </a>
                )}
                <Link
                  href={`/admin/blog/${post.id}`}
                  className="text-[13px] font-semibold underline underline-offset-2"
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Container>
  );
}
