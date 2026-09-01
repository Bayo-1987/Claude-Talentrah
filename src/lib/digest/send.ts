import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { isFeatureEnabled } from "@/lib/flags/read";
import { buildDigestEmail } from "./template";
import { DIGEST_WINDOW_DAYS, selectDigestJobs, type DigestCandidate } from "./select";

/**
 * The weekly job-match digest run.
 *
 * ── THE FLAG IS CHECKED FIRST, BEFORE ANY WORK AT ALL ─────────────────────
 *
 * Not before the send call — before the queries. Two reasons, and the second
 * is the one that matters: a flag read after the work is a flag that still
 * costs a full scan of every user every week while the feature is "off", and
 * more importantly it puts a decision between "we decided not to send" and the
 * send itself, which is exactly where a future refactor drops the check.
 *
 * `isFeatureEnabled` fails closed on an unknown key, a missing row and a
 * database error alike, so every way this can go wrong ends in not sending.
 *
 * ── THE THREE SWITCHES, WHICH ARE NOT THE SAME SWITCH ─────────────────────
 *
 *   feature_flags.job_match_digest   does the product send at all
 *   email_preferences.job_match_digest  does THIS PERSON want it
 *   RESEND_API_KEY                   can we send anything
 *
 * They are checked separately and none substitutes for another. In particular,
 * turning the feature on must never resurrect somebody who unsubscribed — that
 * is why the per-user preference is a column on its own table rather than a
 * derived state of the flag.
 */

export interface DigestRunSummary {
  enabled: boolean;
  considered: number;
  sent: number;
  skippedNoJobs: number;
  failed: number;
  /** Set when the run did no work, so a caller can say why rather than guess. */
  reason?: string;
}

/** Bounded so one run cannot fan out unboundedly as the user base grows. */
const MAX_RECIPIENTS_PER_RUN = 500;

export async function sendJobMatchDigest(now: Date = new Date()): Promise<DigestRunSummary> {
  const base: DigestRunSummary = {
    enabled: false,
    considered: 0,
    sent: 0,
    skippedNoJobs: 0,
    failed: 0,
  };

  if (!(await isFeatureEnabled("job_match_digest"))) {
    // The normal state today. Logged at info, not error — this is the feature
    // behaving as shipped, not a fault.
    console.log("[digest] feature flag off — no digest sent, no recipients read");
    return { ...base, reason: "feature flag off" };
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[digest] RESEND_API_KEY is not set — cannot send");
    return { ...base, enabled: true, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();
  const since = new Date(now.getTime() - DIGEST_WINDOW_DAYS * 86_400_000).toISOString();

  /*
   * Only people who want it. `digest_last_sent_at` is checked here rather than
   * after building the email, so a cron that fires twice in a week is a no-op
   * on the second run rather than a duplicate in somebody's inbox.
   */
  const { data: recipients, error: recipientsError } = await supabase
    .from("email_preferences")
    .select("user_id, unsubscribe_token, digest_last_sent_at, profiles!inner(email, first_name)")
    .eq("job_match_digest", true)
    .or(`digest_last_sent_at.is.null,digest_last_sent_at.lt.${since}`)
    .limit(MAX_RECIPIENTS_PER_RUN);

  if (recipientsError) {
    console.error("[digest] could not read recipients:", recipientsError.message);
    return { ...base, enabled: true, reason: recipientsError.message };
  }

  const summary: DigestRunSummary = { ...base, enabled: true, considered: recipients?.length ?? 0 };

  for (const recipient of recipients ?? []) {
    const profile = recipient.profiles as unknown as { email: string; first_name: string | null };
    if (!profile?.email) continue;

    try {
      const candidates = await loadCandidates(supabase, recipient.user_id, since);
      const jobs = selectDigestJobs(candidates);

      if (jobs.length === 0) {
        // A quiet week is a silent week. Deliberately does NOT stamp
        // digest_last_sent_at: nothing was sent, so nothing should suppress
        // next week's attempt.
        summary.skippedNoJobs++;
        continue;
      }

      const email = buildDigestEmail({
        firstName: profile.first_name,
        jobs,
        unsubscribeToken: recipient.unsubscribe_token,
      });

      await resend.emails.send({
        from: "Farah at Talentrah <farah@talentrah.com>",
        to: profile.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: {
          /*
           * One-click unsubscribe, which Gmail and Yahoo require of bulk
           * senders. Without it a digest is far likelier to be marked spam
           * than unsubscribed, and that damages every other email we send.
           */
          "List-Unsubscribe": `<${unsubscribeUrlFor(recipient.unsubscribe_token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      // Stamped only after a successful send, so a failure retries next run
      // rather than being silently skipped for a week.
      const { error: stampError } = await supabase
        .from("email_preferences")
        .update({ digest_last_sent_at: now.toISOString() })
        .eq("user_id", recipient.user_id);
      if (stampError) {
        // A rejected update RESOLVES with an error. Unchecked, this would be
        // the bug that mails somebody the same digest every day.
        console.error("[digest] sent but could not stamp", recipient.user_id, stampError.message);
      }

      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error("[digest] failed for", recipient.user_id, err);
    }
  }

  console.log(
    `[digest] considered=${summary.considered} sent=${summary.sent} ` +
      `skippedNoJobs=${summary.skippedNoJobs} failed=${summary.failed}`,
  );
  return summary;
}

/**
 * The same URL the email body links to, built the same way, so the
 * List-Unsubscribe header and the visible link can never drift apart.
 */
function unsubscribeUrlFor(token: string): string {
  return absoluteUrl(`/unsubscribe?token=${encodeURIComponent(token)}`);
}

/**
 * The week's scored, unacted-on postings for one person.
 *
 * Scores come from `match_scores`, which the feed already computes and stores —
 * the digest deliberately does NOT recompute them. Recomputing would make a
 * weekly email the most expensive thing in the system and could disagree with
 * what the person sees on the feed, which is worse than being slightly stale.
 */
async function loadCandidates(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  since: string,
): Promise<DigestCandidate[]> {
  const { data, error } = await supabase
    .from("match_scores")
    .select("score, job_posting_id, job_postings!inner(id, title, company_name, location, posted_at, status)")
    .eq("user_id", userId)
    .eq("job_postings.status", "open")
    .gte("job_postings.posted_at", since);
  if (error) throw error;

  const jobIds = (data ?? []).map((r) => r.job_posting_id);
  if (jobIds.length === 0) return [];

  // Saved or applied — either means they have seen it, so it is not news.
  const { data: acted, error: actedError } = await supabase
    .from("applications")
    .select("job_posting_id")
    .eq("user_id", userId)
    .in("job_posting_id", jobIds);
  if (actedError) throw actedError;
  const seen = new Set((acted ?? []).map((a) => a.job_posting_id));

  return (data ?? []).map((row) => {
    const job = row.job_postings as unknown as {
      id: string;
      title: string;
      company_name: string;
      location: string | null;
      posted_at: string;
    };
    return {
      jobId: job.id,
      title: job.title,
      companyName: job.company_name,
      location: job.location,
      score: row.score,
      postedAt: job.posted_at,
      alreadyActedOn: seen.has(row.job_posting_id),
    };
  });
}
