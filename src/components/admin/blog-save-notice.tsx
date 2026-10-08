import Link from "next/link";
import type { BlogActionState } from "@/lib/admin/blog/actions";

/**
 * The result of "Save changes" on a blog post, shown NEXT TO the button (the form is long: a banner at the top was never seen). A saved published post links to the live page at the slug
 * that was just saved; a saved draft says it is not public yet instead of linking to a page that would 404; a failed save shows the server's message as an alert. Nothing before the first save.
 */
export function BlogSaveNotice({ state, slug, published }: { state: BlogActionState; slug: string; published: boolean }) {
  if (state.status === "success") {
    const liveSlug = state.savedSlug ?? slug;
    return (
      <p role="status" className="border-[1.5px] border-green px-3.5 py-2.5 text-[13.5px] text-green">
        Saved
        {published ? (
          <>
            {" · "}
            <Link href={`/blog/${liveSlug}`} className="font-semibold underline underline-offset-2">
              View post
            </Link>
          </>
        ) : (
          " · draft, not public yet"
        )}
      </p>
    );
  }
  if (state.status === "error" && state.message) {
    return (
      <p role="alert" className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
        {state.message}
      </p>
    );
  }
  return null;
}
