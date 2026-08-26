"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireEmployer, type EmployerContext } from "@/lib/employer/membership";
import type { EmployerActionState } from "@/lib/employer/actions";

/**
 * Ad campaign actions. Schema and the money boundary live in migrations 0046
 * (wallet) and 0047/0048 (campaigns); this is the layer that decides WHO may
 * ask for those things.
 *
 * The split is deliberate and worth stating, because it looks like duplication:
 *   * DRAFTS go through the user's own client, so the RLS policies are the
 *     gate — a regression there breaks campaign creation loudly rather than
 *     being silently bypassed by a service-role write. Same reasoning as
 *     postJobAction.
 *   * ANYTHING THAT MOVES MONEY OR CHANGES STATUS goes through a
 *     SECURITY DEFINER RPC, because those functions take the organisation as
 *     an argument and must not be callable by a client that could pass someone
 *     else's id.
 */

/** Roles permitted to spend the organisation's money (plan doc §7.4). */
const SPEND_ROLES = ["owner", "admin"] as const;

/**
 * Authorises a money-moving or campaign-state action.
 *
 * HONEST NOTE ON WHAT THIS CURRENTLY DOES: nothing. `org_member_role` has
 * exactly two values, `owner` and `admin`, and §7.4 decided both may spend —
 * so every member passes. It is written anyway, and written HERE rather than
 * in the database, for two reasons:
 *
 *   1. It is the seam where a third role would land. If a `viewer` or
 *      `analyst` role is ever added, spend authority must not extend to it by
 *      default, and the fix should be adding a role to this array rather than
 *      remembering that six call sites each need a check.
 *   2. Putting it in the RPC instead would be worse: those functions take
 *      `p_actor_user_id` as an argument they cannot verify, so a role check
 *      there would be checking a claim rather than a fact. The Server Action
 *      is the only layer holding a real session.
 *
 * It is NOT a security control today. Do not read it as one — the actual gates
 * are the RLS policies and the service_role-only grants on the RPCs.
 */
function requireSpendAuthority(context: EmployerContext): EmployerActionState | null {
  if (!SPEND_ROLES.includes(context.role as (typeof SPEND_ROLES)[number])) {
    return { error: "You don't have permission to manage campaigns for this company." };
  }
  return null;
}

function readCampaignForm(form: FormData) {
  const num = (k: string) => {
    const raw = form.get(k);
    const n = typeof raw === "string" ? Number(raw.replace(/[^0-9]/g, "")) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };
  const list = (k: string) => {
    const raw = form.get(k);
    if (typeof raw !== "string" || !raw.trim()) return null;
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return items.length ? items : null;
  };
  return {
    name: String(form.get("name") ?? "").trim(),
    jobPostingId: String(form.get("jobPostingId") ?? "").trim(),
    dailyRate: num("dailyRate"),
    totalBudget: num("totalBudget"),
    endsOn: String(form.get("endsOn") ?? "").trim() || null,
    targetLocations: list("targetLocations"),
  };
}

export async function createCampaignAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const context = await requireEmployer();
  const denied = requireSpendAuthority(context);
  if (denied) return denied;

  const supabase = await createClient();
  const f = readCampaignForm(form);

  if (!f.name) return { error: "Give the campaign a name." };
  if (!f.jobPostingId) return { error: "Choose which job this campaign promotes." };
  if (!Number.isFinite(f.dailyRate) || f.dailyRate <= 0) {
    return { error: "Set a daily budget above zero." };
  }
  if (!Number.isFinite(f.totalBudget) || f.totalBudget < f.dailyRate) {
    return { error: "The total budget has to cover at least one day." };
  }

  // Through the user's client: the INSERT policy checks membership AND that
  // the posting belongs to the same organisation — a campaign pointing at
  // someone else's job would be an ad for a competitor, paid for by the
  // victim. Letting the policy decide keeps that check in one place.
  const { data, error } = await supabase
    .from("ad_campaigns")
    .insert({
      organization_id: context.organization.id,
      job_posting_id: f.jobPostingId,
      name: f.name,
      daily_rate_ngn: f.dailyRate,
      total_budget_ngn: f.totalBudget,
      ends_on: f.endsOn,
      target_locations: f.targetLocations,
      created_by: context.userId,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    // 42501 is the RLS refusal, which here almost always means the chosen
    // posting is not this organisation's.
    if (error?.code === "42501") {
      return { error: "That job posting doesn't belong to your company." };
    }
    return { error: `Couldn't create the campaign: ${error?.message ?? "unknown error"}` };
  }

  revalidatePath("/employer/campaigns");
  redirect(`/employer/campaigns/${data.id}`);
}

export async function updateCampaignAction(
  campaignId: string,
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const context = await requireEmployer();
  const denied = requireSpendAuthority(context);
  if (denied) return denied;

  const supabase = await createClient();
  const f = readCampaignForm(form);
  if (!f.name) return { error: "Give the campaign a name." };
  if (!Number.isFinite(f.totalBudget) || f.totalBudget < f.dailyRate) {
    return { error: "The total budget has to cover at least one day." };
  }

  // The UPDATE policy restricts this to `status = 'draft'`, and the column
  // grant restricts WHICH columns — so a live campaign's budget cannot be
  // edited out from under a charge already taken.
  const { error } = await supabase
    .from("ad_campaigns")
    .update({
      name: f.name,
      daily_rate_ngn: f.dailyRate,
      total_budget_ngn: f.totalBudget,
      ends_on: f.endsOn,
      target_locations: f.targetLocations,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  if (error) return { error: `Couldn't save the campaign: ${error.message}` };
  revalidatePath(`/employer/campaigns/${campaignId}`);
  return { ok: true };
}

export async function submitCampaignForReviewAction(
  campaignId: string,
): Promise<EmployerActionState> {
  const context = await requireEmployer();
  const denied = requireSpendAuthority(context);
  if (denied) return denied;

  // Ownership is checked here because the RPC cannot: it is service_role and
  // takes the campaign id, so nothing inside it knows whose session this is.
  const owned = await assertCampaignBelongsToOrg(campaignId, context);
  if (owned) return owned;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("submit_ad_campaign_for_review", {
    p_campaign_id: campaignId,
    p_actor_user_id: context.userId,
  });
  if (error) return { error: `Couldn't submit for review: ${error.message}` };
  if (!data) return { error: "Only a draft campaign can be submitted for review." };

  revalidatePath(`/employer/campaigns/${campaignId}`);
  return { ok: true };
}

export async function pauseCampaignAction(campaignId: string): Promise<EmployerActionState> {
  const context = await requireEmployer();
  const denied = requireSpendAuthority(context);
  if (denied) return denied;
  const owned = await assertCampaignBelongsToOrg(campaignId, context);
  if (owned) return owned;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("pause_ad_campaign", { p_campaign_id: campaignId });
  if (error) return { error: `Couldn't pause the campaign: ${error.message}` };
  if (!data) return { error: "That campaign isn't running." };

  revalidatePath(`/employer/campaigns/${campaignId}`);
  return { ok: true };
}

export async function resumeCampaignAction(campaignId: string): Promise<EmployerActionState> {
  const context = await requireEmployer();
  const denied = requireSpendAuthority(context);
  if (denied) return denied;
  const owned = await assertCampaignBelongsToOrg(campaignId, context);
  if (owned) return owned;

  /*
   * Resuming CHARGES. It does not check the balance and then activate — the
   * RPC's conditional UPDATE is the check, because the balance recorded when
   * the campaign paused is stale by construction: other campaigns in the same
   * organisation draw from the same wallet.
   *
   * So the failure here is not an error to apologise for, it is the answer to
   * a question, and the message says which.
   */
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("resume_ad_campaign", {
    p_campaign_id: campaignId,
    p_actor_user_id: context.userId,
  });
  if (error) return { error: `Couldn't resume the campaign: ${error.message}` };

  const result = data?.[0];
  if (!result?.ok) {
    if (result?.status === "paused_insufficient_funds") {
      return {
        error:
          `Your ad wallet doesn't have enough to cover a day of this campaign` +
          `${result.balance_after_ngn !== null ? ` (balance ₦${result.balance_after_ngn.toLocaleString()})` : ""}. ` +
          `Top up and try again.`,
      };
    }
    if (result?.status === "completed") {
      return { error: "This campaign has finished — its budget or end date is used up." };
    }
    return { error: "That campaign isn't paused." };
  }

  revalidatePath(`/employer/campaigns/${campaignId}`);
  revalidatePath("/employer/campaigns");
  return { ok: true };
}

/**
 * Confirms the campaign is this organisation's before handing its id to a
 * service_role RPC.
 *
 * Necessary precisely BECAUSE the RPCs are service_role: they bypass RLS, so
 * passing an arbitrary campaign id would act on someone else's campaign. The
 * lookup runs through the USER's client so the SELECT policy answers — a
 * campaign the session cannot see comes back as not-found, which is also the
 * answer we want to give.
 */
async function assertCampaignBelongsToOrg(
  campaignId: string,
  context: EmployerContext,
): Promise<EmployerActionState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();

  if (error) return { error: `Couldn't load that campaign: ${error.message}` };
  // Same answer for "no such campaign" and "not yours", so this cannot be used
  // to probe which campaign ids exist.
  if (!data) return { error: "That campaign isn't available." };
  return null;
}
