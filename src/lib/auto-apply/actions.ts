"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { spendCredits } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MIN_SCORE,
} from "./config";
import { scanAndQueue } from "./queue";

export type AutoApplyResult =
  | { ok: true; outcome: "submitted" | "handed_off" | "dismissed"; externalUrl?: string | null }
  | { ok: false; error: string };

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return user.id;
}

/**
 * Toggle Auto-Apply on or off.
 *
 * The only Auto-Apply value a user is allowed to write, and the only one that
 * goes through their own client — so the RLS policy is what authorises it,
 * exactly as the employer surface does with organisations. `enabled_at` is a
 * server observation and is not in the column grant (0033), so it is stamped
 * with the service role.
 */
export async function setAutoApplyEnabledAction(enabled: boolean): Promise<AutoApplyResult> {
  const userId = await requireUserId();
  const admin = createServiceRoleClient();

  const { error } = await admin.from("auto_apply_settings").upsert(
    {
      user_id: userId,
      enabled,
      enabled_at: enabled ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: `Couldn't update Auto-Apply: ${error.message}` };

  // Turning it on should produce something to review immediately, otherwise the
  // feature looks broken until the next feed load.
  if (enabled) {
    try {
      await scanAndQueue(userId);
    } catch {
      // A failed scan is not a failed toggle — the next feed load retries.
    }
  }

  revalidatePath("/jobs");
  revalidatePath("/auto-apply");
  return { ok: true, outcome: enabled ? "submitted" : "dismissed" };
}

/**
 * Confirm a queued match — the only path that creates an application the user
 * did not click "Apply" on.
 *
 * Every gate lives in `auto_apply_claim_submission` (0034), which runs the
 * threshold re-check, the cap and the affordability check inside a single
 * per-user lock. Nothing here re-decides any of that; this function's job is to
 * carry out what the claim authorised, and to release the claim if it can't.
 */
export async function confirmAutoApplyAction(queueId: string): Promise<AutoApplyResult> {
  const userId = await requireUserId();
  const admin = createServiceRoleClient();

  const { data: verdicts, error: claimError } = await admin.rpc("auto_apply_claim_submission", {
    p_user_id: userId,
    p_queue_id: queueId,
    p_min_score: AUTO_APPLY_MIN_SCORE,
    p_daily_cap: AUTO_APPLY_DAILY_SUBMIT_CAP,
    p_free_per_week: AUTO_APPLY_FREE_PER_WEEK,
    p_credit_cost: CREDIT_COSTS.autoApplySubmission,
  });
  if (claimError) return { ok: false, error: `Couldn't confirm: ${claimError.message}` };

  const verdict = verdicts?.[0];
  if (!verdict) return { ok: false, error: "Couldn't confirm: no response from the queue." };

  if (!verdict.ok) {
    return { ok: false, error: explain(verdict.reason) };
  }

  // ---- External: hand off, never submit. -------------------------------
  // Talentrah has no ATS integration; confirming an external match records the
  // hand-off and returns the source URL for the user to finish themselves. It
  // deliberately does NOT create an "applied" row — claiming they applied when
  // they have only been handed a link would be a lie in their own tracker.
  if (verdict.reason === "handed_off") {
    const { data: job } = await admin
      .from("job_postings")
      .select("external_url")
      .eq("id", verdict.job_posting_id!)
      .maybeSingle();

    await admin.from("applications").upsert(
      {
        user_id: userId,
        job_posting_id: verdict.job_posting_id!,
        stage: "saved",
        source: "auto_apply",
      },
      { onConflict: "user_id,job_posting_id" },
    );

    revalidatePath("/auto-apply");
    revalidatePath("/tracker");
    return { ok: true, outcome: "handed_off", externalUrl: job?.external_url ?? null };
  }

  // ---- Internal: a real submission on the user's behalf. ----------------
  try {
    if (verdict.charge > 0) {
      await spendCredits(userId, verdict.charge, "auto_apply_run", queueId);
    }

    const { data: baseResume } = await admin
      .from("resumes")
      .select("id")
      .eq("user_id", userId)
      .eq("is_base", true)
      .maybeSingle();

    const { data: application, error: appError } = await admin
      .from("applications")
      .upsert(
        {
          user_id: userId,
          job_posting_id: verdict.job_posting_id!,
          resume_id: baseResume?.id ?? null,
          stage: "applied",
          source: "auto_apply",
          applied_at: new Date().toISOString(),
        },
        { onConflict: "user_id,job_posting_id" },
      )
      .select("id")
      .single();
    if (appError) throw new Error(appError.message);

    await admin
      .from("auto_apply_queue")
      .update({ application_id: application!.id })
      .eq("id", queueId);
  } catch (err) {
    // Release the claim so the allowance isn't silently consumed by a
    // submission that never happened. The claim being reversible is why 0034
    // can safely mark the row before this runs.
    await admin
      .from("auto_apply_queue")
      .update({ status: "pending", decided_at: null, credits_spent: 0 })
      .eq("id", queueId);
    return {
      ok: false,
      error: err instanceof Error ? `Couldn't submit: ${err.message}` : "Couldn't submit.",
    };
  }

  revalidatePath("/auto-apply");
  revalidatePath("/jobs");
  revalidatePath("/tracker");
  return { ok: true, outcome: "submitted" };
}

export async function dismissAutoApplyAction(queueId: string): Promise<AutoApplyResult> {
  const userId = await requireUserId();
  const admin = createServiceRoleClient();

  // Scoped to the session user AND to `pending`, so a dismiss cannot rewrite an
  // already-submitted entry's history in the log.
  const { error } = await admin
    .from("auto_apply_queue")
    .update({ status: "dismissed", decided_at: new Date().toISOString() })
    .eq("id", queueId)
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) return { ok: false, error: `Couldn't dismiss: ${error.message}` };

  revalidatePath("/auto-apply");
  return { ok: true, outcome: "dismissed" };
}

function explain(reason: string): string {
  switch (reason) {
    case "not_found":
      return "That match is no longer in your queue.";
    case "already_decided":
      return "You've already decided on that one.";
    case "job_closed":
      return "That job has since closed, so it wasn't applied to.";
    case "below_threshold":
      return `That job no longer scores ${AUTO_APPLY_MIN_SCORE}+ against your resume, so Auto-Apply won't submit it.`;
    case "daily_cap":
      return `You've hit the Auto-Apply limit of ${AUTO_APPLY_DAILY_SUBMIT_CAP} submissions a day. It resets as the oldest one passes 24 hours.`;
    case "insufficient_credits":
      return `You've used your ${AUTO_APPLY_FREE_PER_WEEK} free Auto-Applies this week, and there aren't enough credits for the next one (${CREDIT_COSTS.autoApplySubmission} credits).`;
    default:
      return "Couldn't confirm that one.";
  }
}
