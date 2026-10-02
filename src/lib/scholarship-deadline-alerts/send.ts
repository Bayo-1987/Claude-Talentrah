import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { isFeatureEnabled } from "@/lib/flags/read";
import { buildScholarshipDeadlineEmail } from "./template";
import { selectDeadlineAlertCandidates, SCHOLARSHIP_DEADLINE_REMINDER_DAYS, type DeadlineAlertCandidate } from "./select";

/**
 * The daily scholarship-deadline-alert run.
 *
 * Same three-switch shape as the job digest (src/lib/digest/send.ts) and
 * 0128's proactive match alert — checked in this order, before any work:
 *
 *   feature_flags.scholarship_deadline_alert   does the product send at all
 *   email_preferences.scholarship_deadline_alert  does THIS PERSON want it
 *   RESEND_API_KEY                             can we send anything
 *
 * A SEPARATE CRON FROM ingest-scholarships, DELIBERATELY. Ingestion's job is
 * fetching/deduping new listings; scanning saved scholarships for approaching
 * deadlines is a different concern with a different failure mode, and every
 * other notification type in this codebase already gets its own cron rather
 * than piggybacking on an unrelated one (send-verification-reminders is
 * separate from whatever creates organizations; mentorship-session-reminders
 * is separate from mentorship-sweep).
 */

export interface ScholarshipDeadlineAlertRunSummary {
  enabled: boolean;
  considered: number;
  sent: number;
  failed: number;
  reason?: string;
}

/** Bounded so one run cannot fan out unboundedly as saved scholarships grow. */
const MAX_ALERTS_PER_RUN = 500;

export async function sendScholarshipDeadlineAlerts(
  now: Date = new Date(),
): Promise<ScholarshipDeadlineAlertRunSummary> {
  const base: ScholarshipDeadlineAlertRunSummary = {
    enabled: false,
    considered: 0,
    sent: 0,
    failed: 0,
  };

  if (!(await isFeatureEnabled("scholarship_deadline_alert"))) {
    console.log("[scholarship-deadline-alerts] feature flag off — no alerts sent, no candidates read");
    return { ...base, reason: "feature flag off" };
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[scholarship-deadline-alerts] RESEND_API_KEY is not set — cannot send");
    return { ...base, enabled: true, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();

  /*
   * Cheap filters only, at the DB level — status and "never reminded". The
   * decision that actually matters (the verified-deadline bar, the public-
   * visibility gate, the date window) lives entirely in the pure, tested
   * selectDeadlineAlertCandidates, same split digest/send.ts uses between
   * loadCandidates' broad DB query and selectDigestJobs' own filtering.
   */
  const { data: rows, error } = await supabase
    .from("scholarship_saves")
    .select(
      "id, user_id, status, deadline_reminder_sent_at, scholarship_id, scholarships!inner(id, program_name, provider, application_deadline, close_time, close_tz, deadline_verified_at, official_url, moderation_status), profiles!inner(email, first_name)",
    )
    .in("status", ["saved", "applying"])
    .is("deadline_reminder_sent_at", null)
    .limit(MAX_ALERTS_PER_RUN * 4);

  if (error) {
    console.error("[scholarship-deadline-alerts] could not read candidates:", error.message);
    return { ...base, enabled: true, reason: error.message };
  }

  type JoinedScholarship = {
    id: string;
    program_name: string;
    provider: string;
    application_deadline: string | null;
    close_time: string | null;
    close_tz: string | null;
    deadline_verified_at: string | null;
    official_url: string;
    moderation_status: DeadlineAlertCandidate["moderationStatus"];
  };
  type JoinedProfile = { email: string; first_name: string | null };

  /** DeadlineAlertCandidate plus the two profile fields the email needs — kept off the pure type since select.ts has no reason to know about email/name. */
  type EnrichedCandidate = DeadlineAlertCandidate & { email: string; firstName: string | null };

  const candidates: EnrichedCandidate[] = (rows ?? []).map((row) => {
    const scholarship = row.scholarships as unknown as JoinedScholarship;
    const profile = row.profiles as unknown as JoinedProfile;
    return {
      saveId: row.id,
      userId: row.user_id,
      status: row.status,
      deadlineReminderSentAt: row.deadline_reminder_sent_at,
      scholarshipId: scholarship.id,
      programName: scholarship.program_name,
      provider: scholarship.provider,
      applicationDeadline: scholarship.application_deadline,
      closeTime: scholarship.close_time,
      closeTz: scholarship.close_tz,
      deadlineVerifiedAt: scholarship.deadline_verified_at,
      officialUrl: scholarship.official_url,
      moderationStatus: scholarship.moderation_status,
      email: profile.email,
      firstName: profile.first_name,
    };
  });

  const eligible = selectDeadlineAlertCandidates(candidates, now).slice(0, MAX_ALERTS_PER_RUN);
  const summary: ScholarshipDeadlineAlertRunSummary = { ...base, enabled: true, considered: eligible.length };
  if (eligible.length === 0) return summary;

  // unsubscribe tokens are on email_preferences, one row per user — fetched
  // separately rather than joined, matching digest/send.ts's own pattern of
  // resolving cross-table facts once for the set of ids actually needed.
  const userIds = Array.from(new Set(eligible.map((c) => c.userId)));
  const { data: prefRows, error: prefError } = await supabase
    .from("email_preferences")
    .select("user_id, unsubscribe_token, scholarship_deadline_alert")
    .in("user_id", userIds);
  if (prefError) {
    console.error("[scholarship-deadline-alerts] could not read preferences:", prefError.message);
    return { ...summary, reason: prefError.message };
  }
  const prefByUser = new Map((prefRows ?? []).map((p) => [p.user_id, p]));


  for (const candidate of eligible) {
    const pref = prefByUser.get(candidate.userId);
    // Opted out — this person's preference, checked independently of the
    // product-level flag above, per this file's own header.
    if (!pref?.scholarship_deadline_alert) continue;

    try {
      const email = buildScholarshipDeadlineEmail({
        firstName: candidate.firstName,
        candidate,
        unsubscribeToken: pref.unsubscribe_token,
      });

      await resend.emails.send({
        from: "Talentrah <notifications@talentrah.com>",
        to: candidate.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrlFor(pref.unsubscribe_token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      // Stamped only after a successful send, so a failure retries next run
      // rather than being silently skipped forever.
      const { error: stampError } = await supabase
        .from("scholarship_saves")
        .update({ deadline_reminder_sent_at: now.toISOString() })
        .eq("id", candidate.saveId);
      if (stampError) {
        // A rejected update RESOLVES with an error (CLAUDE.md's own standing
        // note on Supabase deletes/updates) — unchecked, this is the bug that
        // mails the same reminder every day until the deadline passes.
        console.error(
          "[scholarship-deadline-alerts] sent but could not stamp",
          candidate.saveId,
          stampError.message,
        );
      }

      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error("[scholarship-deadline-alerts] failed for", candidate.saveId, err);
    }
  }

  console.log(
    `[scholarship-deadline-alerts] considered=${summary.considered} sent=${summary.sent} failed=${summary.failed}`,
  );
  return summary;
}

/**
 * The same URL the email body links to, built the same way, so the
 * List-Unsubscribe header and the visible link can never drift apart —
 * matches digest/send.ts's own `unsubscribeUrlFor`. `pref=` is required:
 * 0128's multi-preference unsubscribe page defaults to job_match_digest
 * otherwise.
 */
function unsubscribeUrlFor(token: string): string {
  return absoluteUrl(`/unsubscribe?token=${encodeURIComponent(token)}&pref=scholarship_deadline_alert`);
}

/** Re-exported for the admin route's own logging/testing convenience. */
export { SCHOLARSHIP_DEADLINE_REMINDER_DAYS };
