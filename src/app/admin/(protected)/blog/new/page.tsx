import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createPostAction } from "@/lib/admin/blog/actions";
import { BlogPostForm } from "@/components/admin/blog-post-form";
import { Container, EyebrowLabel } from "@/components/ui";

export const metadata = {
  title: "New post — Talentrah admin",
  robots: { index: false, follow: false },
};

/** A new post always starts as a draft — see createPostAction. */
export default async function NewBlogPostPage() {
  await requireAdmin();
  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div>
        <EyebrowLabel>Blog</EyebrowLabel>
        <h1 className="mt-2 font-display text-[26px]">New post</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Saved as a draft. Nothing is public until you publish it.{" "}
          <Link href="/admin/blog" className="underline">Back to posts</Link>
        </p>
      </div>
      <BlogPostForm action={createPostAction} submitLabel="Create draft" />
    </Container>
  );
}
