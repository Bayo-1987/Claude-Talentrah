"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { blogPostSchema } from "./schemas";

/**
 * Blog mutations, under an admin session.
 *
 * ── WHY SERVICE ROLE ──────────────────────────────────────────────────────
 *
 * 0074 revoked insert/update/delete from anon and authenticated, so there is
 * no client role that can write this table at all. That is deliberate: it
 * makes "only admins publish" structural rather than a policy someone could
 * widen. Writes therefore go through the service role after requireAdmin(),
 * the same path every other admin mutation in this codebase takes.
 *
 * ── EVERY MUTATION IS AUDITED ─────────────────────────────────────────────
 *
 * Five actions, five recordAdminAction calls. `recordAdminAction` never
 * throws — an audit write that failed must not roll back the change it was
 * describing — so the call is fire-and-forget by design, not by omission.
 *
 * ── WHY PATHS ARE REVALIDATED BY HAND ─────────────────────────────────────
 *
 * /blog and /blog/[slug] are statically prerendered from the database (see
 * lib/supabase/public-read.ts for why they can be). Static means a publish
 * would otherwise not appear until the next deploy, which is the exact problem
 * this whole change exists to remove. The sitemap is revalidated too — it is
 * force-dynamic today, but it costs nothing and stops being a silent
 * dependency if that ever changes.
 */

export interface BlogActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function revalidateBlog(slug?: string) {
  revalidatePath("/blog");
  revalidatePath("/sitemap.xml");
  if (slug) revalidatePath(`/blog/${slug}`);
}

function parse(formData: FormData) {
  return blogPostSchema.safeParse({
    slug: formData.get("slug"),
    title: formData.get("title"),
    description: formData.get("description"),
    author: formData.get("author"),
    body: formData.get("body"),
  });
}

export async function createPostAction(
  _prev: BlogActionState,
  formData: FormData,
): Promise<BlogActionState> {
  const admin = await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the fields below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("blog_posts")
    // Always created as a DRAFT. Publishing is a separate, deliberate act —
    // there is no "save and publish" here, because the preview is the point.
    .insert({ ...parsed.data, status: "draft", created_by: admin.adminId, updated_by: admin.adminId })
    .select("id, slug")
    .single();

  if (error) {
    // 23505 is the unique index on slug — the one error an operator can fix.
    const duplicate = error.code === "23505";
    return {
      status: "error",
      message: duplicate
        ? "A post with that slug already exists."
        : `Couldn't create the post: ${error.message}`,
      fieldErrors: duplicate ? { slug: ["Already taken."] } : undefined,
    };
  }

  await recordAdminAction({
    identity: admin,
    action: "blog.create",
    targetTable: "blog_posts",
    targetId: data.id,
    detail: { slug: data.slug },
  });

  revalidateBlog();
  redirect(`/admin/blog/${data.id}`);
}

export async function updatePostAction(
  _prev: BlogActionState,
  formData: FormData,
): Promise<BlogActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Missing post." };

  const parsed = parse(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the fields below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = createServiceRoleClient();
  /*
   * The OLD slug is read first so both can be revalidated. Renaming a
   * published post's slug changes its URL; revalidating only the new one
   * leaves the old path serving the post from cache under a URL that no
   * longer exists in the sitemap.
   */
  const { data: before } = await supabase.from("blog_posts").select("slug").eq("id", id).maybeSingle();

  const { error } = await supabase
    .from("blog_posts")
    .update({ ...parsed.data, updated_by: admin.adminId, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    const duplicate = error.code === "23505";
    return {
      status: "error",
      message: duplicate ? "Another post already uses that slug." : `Couldn't save: ${error.message}`,
      fieldErrors: duplicate ? { slug: ["Already taken."] } : undefined,
    };
  }

  await recordAdminAction({
    identity: admin,
    action: "blog.update",
    targetTable: "blog_posts",
    targetId: id,
    detail: { slug: parsed.data.slug, previousSlug: before?.slug ?? null },
  });

  revalidateBlog(parsed.data.slug);
  if (before?.slug && before.slug !== parsed.data.slug) revalidatePath(`/blog/${before.slug}`);
  return { status: "success", message: "Saved." };
}

/**
 * Publish or unpublish.
 *
 * UNPUBLISHING IS THE NORMAL WAY TO RETIRE A POST, and delete is the exception
 * — the same reasoning this codebase applies to job postings, where `closed`
 * keeps the row and its history rather than vaporising it. An unpublished post
 * keeps its id, its audit trail, and its `published_at`, so "when was this
 * live, and who took it down" stays answerable.
 *
 * `published_at` is set on first publish and NEVER cleared. Re-publishing a
 * post that was taken down keeps the original date, because that is when it
 * was published; overwriting it would silently reorder /blog and make an old
 * post look new.
 */
export async function setPostStatusAction(
  _prev: BlogActionState,
  formData: FormData,
): Promise<BlogActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const publish = String(formData.get("intent") ?? "") === "publish";
  if (!id) return { status: "error", message: "Missing post." };

  const supabase = createServiceRoleClient();
  const { data: before } = await supabase
    .from("blog_posts")
    .select("slug, published_at")
    .eq("id", id)
    .maybeSingle();
  if (!before) return { status: "error", message: "That post no longer exists." };

  const { error } = await supabase
    .from("blog_posts")
    .update({
      status: publish ? "published" : "draft",
      published_at: publish ? (before.published_at ?? new Date().toISOString()) : before.published_at,
      updated_by: admin.adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { status: "error", message: `Couldn't update: ${error.message}` };

  await recordAdminAction({
    identity: admin,
    action: publish ? "blog.publish" : "blog.unpublish",
    targetTable: "blog_posts",
    targetId: id,
    detail: { slug: before.slug },
  });

  revalidateBlog(before.slug);
  return { status: "success", message: publish ? "Published." : "Unpublished — back to draft." };
}

/**
 * Hard delete. Deliberately the less prominent action.
 *
 * The row and its audit trail go; `admin_audit_log` keeps the record of the
 * deletion itself (target_id survives as a plain uuid, since the log holds no
 * FK to this table), so "who removed the post about X" remains answerable even
 * though the post does not.
 */
export async function deletePostAction(
  _prev: BlogActionState,
  formData: FormData,
): Promise<BlogActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Missing post." };

  const supabase = createServiceRoleClient();
  const { data: before } = await supabase
    .from("blog_posts")
    .select("slug, title, status")
    .eq("id", id)
    .maybeSingle();

  // A rejected delete RESOLVES with an error rather than throwing — the
  // failure mode this repo has scar tissue about. Checked explicitly.
  const { error } = await supabase.from("blog_posts").delete().eq("id", id);
  if (error) return { status: "error", message: `Couldn't delete: ${error.message}` };

  await recordAdminAction({
    identity: admin,
    action: "blog.delete",
    targetTable: "blog_posts",
    targetId: id,
    detail: { slug: before?.slug ?? null, title: before?.title ?? null, status: before?.status ?? null },
  });

  revalidateBlog(before?.slug);
  redirect("/admin/blog");
}
