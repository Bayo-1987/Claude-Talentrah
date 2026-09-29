import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { isFeatureEnabled } from "@/lib/flags/read";
import { buildAutoApplyDigestEmail } from "./template";
import { selectAutoApplyDigestSummary, type AutoApplyQueueEntryLike } from "./select";

/**
 * The weekly Auto-Apply proof-of-work digest run — send-463.
 *
 * Modeled directly on sendJobMatchDigest's (src/lib/digest/send.ts) own
 * three-gate structure, same order, same reasoning:
 *
 *   feature_flags.auto_apply_digest    does the product send this at all
 *   email_preferences.job_match_digest does THIS PERSON want the weekly stuff
 *   RESEND_API_KEY                     can we send anything
 *
 * ── WHY job_match_digest, NOT A NEW COLUMN ──────────────────────────────────
 *
 * See migration 0196's own header for the full reasoning — a new,
 * unwired preference column would be worse than sharing the one unsubscribe
 * link that already exists and already works. This send is out of scope for
 * building a second one.
 *
 * ── THE FOURTH FILTER THIS SEND HAS THAT THE MATCH DIGEST DOESN'T:
 * auto_apply_settings.enabled ────────────────────────────────────────────
 *
 * Checked live at send time, not from enabled_at — a user who turned
 * Auto-Apply off mid-week should not get a "here's what Farah did" email
 * for a feature they no longer have on. This is a plain read of current
 * state, not a historical one.
 *
 * ── READ-ONLY OVER auto_apply_queue ─────────────────────────────────────────
 *
 * This module only ever selects from auto_apply_queue, auto_apply_settings,
 * job_postings and match_scores. Nothing here can write to the queue, change
 * a decision, or touch a credit — it is a report of what already happened.
 */

export interface AutoApplyDigestRunSummary {
  enabled: boolean;
  considered: number;
  sent: number;
  skippedNothingHappened: number;
  failed: number;
  reason?: string;
}

/** Mirrors digest/send.ts's own MAX_RECIPIENTS_PER_RUN. */
const MAX_RECIPIENTS_PER_RUN = 500;

/** Same cadence as the match digest — a week of Auto-Apply activity is the natural reporting unit. */
const AUTO_APPLY_DIGEST_WINDOW_DAYS = 7;

export async function sendAutoApplyDigest(now: Date = new Date()): Promise<AutoApplyDigestRunSummary> {
  const base: AutoApplyDigestRunSummary = {
    enabled: false,
    considered: 0,
    sent: 0,
    skippedNothingHappened: 0,
    failed: 0,
  };

  if (!(await isFeatureEnabled("auto_apply_digest"))) {
    console.log("[auto-apply-digest] feature flag off — no digest sent, no recipients read");
    return { ...base, reason: "feature flag off" };
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[auto-apply-digest] RESEND_API_KEY is not set — cannot send");
    return { ...base, enabled: true, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();

  const { data: enabledSettings, error: enabledError } = await supabase
    .from("auto_apply_settings")
    .select("user_id")
    .eq("enabled", true);
  if (enabledError) {
    console.error("[auto-apply-digest] could not read auto_apply_settings:", enabledError.message);
    return { ...base, enabled: true, reason: enabledError.message };
  }
  const enabledUserIds = (enabledSettings ?? []).map((r) => r.user_id);
  if (enabledUserIds.length === 0) {
    // A legitimately empty run, not a failure — same treatment as zero
    // recipients further down, which also completes normally with `sent: 0`
    // and no `reason` set. Logged for visibility only.
    console.log("[auto-apply-digest] no users currently have Auto-Apply enabled — nothing to consider");
    return { ...base, enabled: true };
  }

  const windowStart = new Date(now.getTime() - AUTO_APPLY_DIGEST_WINDOW_DAYS * 86_400_000);
  const since = windowStart.toISOString();

  const { data: recipients, error: recipientsError } = await supabase
    .from("email_preferences")
    .select("user_id, auto_apply_digest_last_sent_at, profiles!inner(email, first_name)")
    .eq("job_match_digest", true)
    .in("user_id", enabledUserIds)
    .or(`auto_apply_digest_last_sent_at.is.null,auto_apply_digest_last_sent_at.lt.${since}`)
    .limit(MAX_RECIPIENTS_PER_RUN);

  if (recipientsError) {
    console.error("[auto-apply-digest] could not read recipients:", recipientsError.message);
    return { ...base, enabled: true, reason: recipientsError.message };
  }

  const summary: AutoApplyDigestRunSummary = { ...base, enabled: true, considered: recipients?.length ?? 0 };

  for (const recipient of recipients ?? []) {
    const profile = recipient.profiles as unknown as { email: string; first_name: string | null };
    if (!profile?.email) continue;

    try {
      const entries = await loadQueueEntries(supabase, recipient.user_id, since);
      const summaryForUser = selectAutoApplyDigestSummary(entries, windowStart, now);

      if (summaryForUser === null) {
        // Genuinely nothing happened this week — stay silent, and do NOT
        // stamp auto_apply_digest_last_sent_at, so a quiet week never
        // suppresses a future week that does have something to report.
        summary.skippedNothingHappened++;
        continue;
      }

      const email = buildAutoApplyDigestEmail(summaryForUser, profile.first_name);

      await resend.emails.send({
        from: "Farah at Talentrah <farah@talentrah.com>",
        to: profile.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      const { error: stampError } = await supabase
        .from("email_preferences")
        .update({ auto_apply_digest_last_sent_at: now.toISOString() })
        .eq("user_id", recipient.user_id);
      if (stampError) {
        console.error("[auto-apply-digest] sent but could not stamp", recipient.user_id, stampError.message);
      }

      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error("[auto-apply-digest] failed for", recipient.user_id, err);
    }
  }

  console.log(
    `[auto-apply-digest] considered=${summary.considered} sent=${summary.sent} ` +
      `skippedNothingHappened=${summary.skippedNothingHappened} failed=${summary.failed}`,
  );
  return summary;
}

type JoinedJobPosting = { title: string; company_name: string };

async function loadQueueEntries(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  since: string,
): Promise<AutoApplyQueueEntryLike[]> {
  const { data, error } = await supabase
    .from("auto_apply_queue")
    .select("status, queued_at, job_posting_id, match_score, job_postings!inner(title, company_name)")
    .eq("user_id", userId)
    .gte("queued_at", since);
  if (error) throw error;

  const rows = data ?? [];
  const jobIds = rows.map((r) => r.job_posting_id);

  /*
   * `explanation` for the thin-tag confidence check — not carried on
   * auto_apply_queue itself (only `match_score`/`tier` are snapshotted
   * there), so read from match_scores by (user_id, job_posting_id), the
   * same key digest/send.ts's own loadCandidates joins on.
   */
  let explanationByJobId = new Map<string, unknown>();
  if (jobIds.length > 0) {
    const { data: scores, error: scoresError } = await supabase
      .from("match_scores")
      .select("job_posting_id, explanation")
      .eq("user_id", userId)
      .in("job_posting_id", jobIds);
    if (scoresError) throw scoresError;
    explanationByJobId = new Map((scores ?? []).map((s) => [s.job_posting_id, s.explanation]));
  }

  return rows.map((row) => {
    const job = row.job_postings as unknown as JoinedJobPosting;
    return {
      status: row.status,
      queuedAt: row.queued_at,
      jobTitle: job.title,
      companyName: job.company_name,
      score: row.match_score,
      explanation: explanationByJobId.get(row.job_posting_id) ?? null,
    };
  });
}
