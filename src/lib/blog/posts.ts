import "server-only";
import { createPublicReadClient } from "@/lib/supabase/public-read";
import type { Tables } from "@/lib/supabase/types";

/**
 * Blog content, read from the database.
 *
 * This used to read .mdx files off disk from src/content/blog, which meant
 * publishing a post was a code change and a deploy — no operator could do it.
 * 0074 moved the four existing posts into `blog_posts` and those files are
 * gone; the migration is their permanent record.
 *
 * ── THESE FUNCTIONS ONLY EVER RETURN PUBLISHED POSTS ──────────────────────
 *
 * Every query here filters `status = 'published'`, and that is the SECOND of
 * two independent guards, not the only one: 0074's RLS policy makes a draft
 * unreadable by anon and by a signed-in seeker alike, so a draft is invisible
 * even to a caller that forgets the filter or asks for it by slug directly.
 *
 * The filter is kept anyway because defence in depth is cheap here, and
 * because the admin screens use the service-role client — which bypasses RLS —
 * so "the policy will catch it" stops being true the moment a query is written
 * on the wrong client. The admin path has its own module for that reason.
 *
 * The client here is the request-less ANON one, not the cookie-backed server
 * client. Two reasons, one of which is a bug this already caused: the
 * cookie client cannot be used in `generateStaticParams` (no request at build
 * time) and reading cookies would make every blog page dynamic. The other is
 * that anon keeps RLS in force — see lib/supabase/public-read.ts.
 */

type Row = Tables<"blog_posts">;

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  /** ISO timestamp the post went live. */
  date: string;
  author: string;
}

export interface BlogPost extends BlogPostMeta {
  /** Raw Markdown. Callers render it through lib/blog/render.ts. */
  content: string;
  /**
   * When the post was last genuinely EDITED, or null if it never has been.
   *
   * Not simply `updated_at`. Every row starts with `updated_at == created_at`,
   * and for the four posts 0074 migrated out of MDX that pair is the moment
   * the migration ran — so passing the column straight through would tell
   * Google all four were modified on 31 August 2026, when what happened that
   * day was a change of storage, not a change of a word. Null means "nothing
   * has edited this since it was created", and the JSON-LD builder omits
   * dateModified rather than inventing one.
   */
  updatedAt: string | null;
}

function toMeta(row: Pick<Row, "slug" | "title" | "description" | "author" | "published_at">): BlogPostMeta {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    author: row.author,
    // Non-null in practice: a published row always has published_at set, by
    // the action that published it. Coalesced rather than asserted so a row
    // hand-edited in the dashboard cannot crash the listing.
    date: row.published_at ?? new Date(0).toISOString(),
  };
}

/** Published posts, newest first — for the /blog listing and the sitemap. */
export async function getAllPosts(): Promise<BlogPostMeta[]> {
  const supabase = createPublicReadClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug, title, description, author, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error) {
    // Logged, not thrown: an empty blog index is a bad page, a 500 is a worse
    // one, and the sitemap treats a throw as a fetch failure against the site.
    console.error("[blog] could not list posts:", error.message);
    return [];
  }
  return (data ?? []).map(toMeta);
}

/** One published post by slug, or null. Drafts return null. */
/**
 * When the post was really edited, or null if it never has been.
 *
 * A row is inserted with `updated_at == created_at`, and both the edit and the
 * publish actions set `updated_at` explicitly — so equal timestamps mean
 * nothing has touched the row since it was created.
 *
 * WHY THIS IS NOT JUST `row.updated_at`. For the four posts 0074 migrated out
 * of MDX, `updated_at` is the moment the migration ran — 2026-08-31 11:52:50,
 * identical across all four on production. Handing that to the BlogPosting
 * builder would have published a `dateModified` claiming every article was
 * freshly modified the day the storage changed, which is a freshness signal
 * the content does not support. Exported so that rule has somewhere to be
 * asserted; it is one comparison and would otherwise be untestable without
 * mocking the database.
 */
export function editedAt(row: Pick<Row, "created_at" | "updated_at">): string | null {
  return row.updated_at === row.created_at ? null : row.updated_at;
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = createPublicReadClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug, title, description, author, body, published_at, created_at, updated_at")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    console.error("[blog] could not read post:", slug, error.message);
    return null;
  }
  if (!data) return null;
  return { ...toMeta(data), content: data.body, updatedAt: editedAt(data) };
}
