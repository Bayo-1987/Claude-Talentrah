"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { PLACEHOLDER_MARKER } from "./courses";
import { PRICE_TIERS } from "./constants";
import type { ModerationState } from "@/lib/admin/moderation/state";

/**
 * Editing the course catalog, under an admin session.
 *
 * Writes are service-role because 0061 revoked insert/update/delete from every
 * client role — "which is what makes 'curated' true rather than
 * aspirational", in its own words. Nothing here widens that; the screen
 * reaches the table the same way the moderation queues reach theirs.
 *
 * `updated_at` is set by hand in every write. There is no trigger on this
 * table — checked, not assumed (`pg_trigger` on the relation: 0 non-internal)
 * — so a column that looks automatic is not, and an edit that skipped it would
 * leave the row claiming it was last touched at seed time.
 */

/**
 * WHY ACTIVATING A PLACEHOLDER ROW IS REFUSED.
 *
 * 0063 exists solely to stop `?ref=talentrah-placeholder` links reaching real
 * users, and it settles what a fresh database starts as. If this screen let an
 * operator flip one of those rows live in a click, that migration would be
 * theatre — the decision would survive only as long as whoever clicks
 * remembers why the rows were off.
 *
 * So the rule is encoded rather than remembered: a row whose affiliate_url
 * still carries the marker cannot be activated. It is not a lock — the way
 * past it is to replace the URL with a real affiliate code, which is precisely
 * the thing that ought to happen first. An operator is never blocked from
 * anything legitimate, only from the one action nobody wants.
 *
 * DEACTIVATING is always allowed, placeholder or not. Turning something off is
 * the safe direction and must never need an argument.
 */
function refusesActivation(url: string): boolean {
  return url.includes(PLACEHOLDER_MARKER);
}

export async function setCourseActiveAction(
  _prev: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requirePermission("courses");
  const id = String(formData.get("id") ?? "");
  const activate = String(formData.get("decision") ?? "") === "activate";
  if (!id) return { status: "error", message: "Missing course.", targetId: id };

  const supabase = createServiceRoleClient();

  const { data: current, error: readError } = await supabase
    .from("course_recommendations")
    .select("affiliate_url, title, active")
    .eq("id", id)
    .maybeSingle();
  if (readError || !current) {
    return { status: "error", message: "No such course.", targetId: id };
  }

  if (activate && refusesActivation(current.affiliate_url)) {
    return {
      status: "error",
      targetId: id,
      message:
        "Still a placeholder link — replace the affiliate URL with a real code first, then activate. Turning this on would publish an un-earning link to real users.",
    };
  }

  const { data, error } = await supabase
    .from("course_recommendations")
    .update({ active: activate, updated_at: new Date().toISOString() })
    .eq("id", id)
    // The precondition in the statement, so two operators clicking at once
    // produce one change and one refusal rather than two writes racing.
    .eq("active", !activate)
    .select("id");

  if (error) {
    console.error("[admin-catalog] toggle", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: id };
  }
  if (!data?.length) {
    return {
      status: "error",
      message: "Already in that state — reload to see the current catalog.",
      targetId: id,
    };
  }

  await recordAdminAction({
    identity: admin,
    action: activate ? "course.activated" : "course.deactivated",
    targetTable: "course_recommendations",
    targetId: id,
    detail: { title: current.title },
  });

  revalidatePath("/admin/courses");
  return {
    status: "success",
    targetId: id,
    message: activate
      ? `“${current.title}” is now live in the recommendations.`
      : `“${current.title}” is no longer offered.`,
  };
}

export async function updateCourseAction(
  _prev: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requirePermission("courses");
  const id = String(formData.get("id") ?? "");
  const skillTag = String(formData.get("skill_tag") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const affiliateUrl = String(formData.get("affiliate_url") ?? "").trim();
  const priceTier = String(formData.get("price_tier") ?? "").trim();

  if (!id) return { status: "error", message: "Missing course.", targetId: id };
  if (!skillTag || !provider || !title || !affiliateUrl) {
    return { status: "error", message: "Every field except the note is required.", targetId: id };
  }
  if (!(PRICE_TIERS as readonly string[]).includes(priceTier)) {
    return { status: "error", message: "Pick a price tier.", targetId: id };
  }
  /*
   * Mirrors course_recommendations_url_is_http. The database is the authority
   * and would refuse this anyway; checking here turns a raw constraint-
   * violation string into a sentence, and does not replace the constraint.
   */
  if (!/^https?:\/\//i.test(affiliateUrl)) {
    return { status: "error", message: "The link must start with http:// or https://.", targetId: id };
  }

  const supabase = createServiceRoleClient();
  const { data: before } = await supabase
    .from("course_recommendations")
    .select("affiliate_url, active")
    .eq("id", id)
    .maybeSingle();

  /*
   * EDITING A LIVE ROW INTO A PLACEHOLDER IS REFUSED TOO, which is the same
   * rule approached from the other side. Without this, the activation guard is
   * bypassable in two steps: activate a real row, then edit its URL back to a
   * placeholder. Deactivate it first if that is genuinely what you want.
   */
  if (before?.active && refusesActivation(affiliateUrl)) {
    return {
      status: "error",
      targetId: id,
      message:
        "That course is live — putting a placeholder link on it would publish an un-earning link. Deactivate it first.",
    };
  }

  const { error } = await supabase
    .from("course_recommendations")
    .update({
      skill_tag: skillTag,
      provider,
      title,
      affiliate_url: affiliateUrl,
      price_tier: priceTier,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[admin-catalog] update", error);
    // 23505 is course_recommendations_unique_offer — one row per provider per
    // skill per title. Worth naming, because the operator can fix it.
    const message =
      error.code === "23505"
        ? "Another course already has that provider, skill and title."
        : "Something went wrong on our end.";
    return { status: "error", message, targetId: id };
  }

  await recordAdminAction({
    identity: admin,
    action: "course.edited",
    targetTable: "course_recommendations",
    targetId: id,
    detail: {
      title,
      // Records THAT the link changed and whether it is still a placeholder,
      // not the URL itself — the row already holds the current value and the
      // log should not become a second place affiliate codes live.
      affiliate_url_changed: before ? before.affiliate_url !== affiliateUrl : null,
      still_placeholder: affiliateUrl.includes(PLACEHOLDER_MARKER),
    },
  });

  revalidatePath("/admin/courses");
  return { status: "success", targetId: id, message: "Saved." };
}
