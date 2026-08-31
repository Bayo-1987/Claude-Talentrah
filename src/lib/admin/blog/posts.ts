import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Tables } from "@/lib/supabase/types";

/**
 * Reading blog posts AS AN ADMIN — drafts included.
 *
 * Separate module from lib/blog/posts.ts on purpose, and the separation is the
 * safety property rather than tidiness. That one uses the anon client so RLS
 * guarantees it can only ever see published rows; this one uses the service
 * role, which bypasses RLS entirely and therefore CAN see drafts.
 *
 * Keeping them apart means no public page can accidentally acquire the ability
 * to read a draft by importing the wrong helper — the client is baked into the
 * module, not passed in. Every function here is only ever called from a screen
 * behind requireAdmin().
 */

export type AdminBlogPost = Tables<"blog_posts">;

/** Every post, drafts first, newest first within each group. */
export async function listAllPosts(): Promise<AdminBlogPost[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    // Drafts first: they are the ones needing a decision. Within a group,
    // most-recently-touched first, so an edit returns to the top of the list
    // where the person who just made it is looking.
    .order("status", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Couldn't load posts: ${error.message}`);
  return data ?? [];
}

/** One post by id, draft or published. */
export async function getPostForEdit(id: string): Promise<AdminBlogPost | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("blog_posts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Couldn't load post: ${error.message}`);
  return data;
}
