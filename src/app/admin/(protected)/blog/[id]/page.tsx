import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/require-admin";
import { getPostForEdit } from "@/lib/admin/blog/posts";
import { updatePostAction } from "@/lib/admin/blog/actions";
import { BlogStatusControls } from "@/components/admin/blog-status-controls";
import { BlogPostForm } from "@/components/admin/blog-post-form";
import { renderMarkdown } from "@/lib/blog/render";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Edit post — Talentrah admin",
  robots: { index: false, follow: false },
};

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("blog");
  const { id } = await params;
  const post = await getPostForEdit(id);
  if (!post) notFound();

  const published = post.status === "published";

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <EyebrowLabel>Blog</EyebrowLabel>
          <h1 className="mt-2 truncate font-display text-[26px]">{post.title}</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {published ? "Published" : "Draft"} · /blog/{post.slug} ·{" "}
            <Link href="/admin/blog" className="underline">Back to posts</Link>
          </p>
        </div>
      </div>

      {/*
        RETIRING A POST MEANS UNPUBLISHING IT, and the layout says so: the
        status control is the prominent one and delete is a separate, quieter
        block below. Same reasoning the job board applies to closed postings —
        keeping the row keeps its history, its audit trail and its published_at,
        and a post can come back without being rewritten.
      */}
      <BorderedCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="font-body text-[14px] font-semibold">
            {published ? "This post is live." : "This post is not public."}
          </p>
          <p className="text-[13px] text-ink-soft">
            {published
              ? "Unpublishing returns it to draft and removes it from /blog and the sitemap. Nothing is lost."
              : "Publishing makes it public immediately and adds it to the sitemap."}
          </p>
        </div>
        <BlogStatusControls id={post.id} published={published} />
      </BorderedCard>

      <BlogPostForm
        action={updatePostAction}
        post={{
          id: post.id,
          slug: post.slug,
          title: post.title,
          description: post.description,
          author: post.author,
          body: post.body,
        }}
        previewHtml={renderMarkdown(post.body)}
        submitLabel="Save changes"
      />

    </Container>
  );
}
