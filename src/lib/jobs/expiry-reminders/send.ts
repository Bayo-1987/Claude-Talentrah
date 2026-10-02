import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import {
  selectEmailableRecipients,
  type EmailableRecipient,
  type RecipientProfile,
  type RecipientSkipReason,
} from "@/lib/email/recipient-eligibility";
import { generateExtendToken } from "./token";
import { buildExpiryReminderEmail } from "./template";

/**
 * The daily "your posting closes soon" run (EMP-1 / E3, migration 0207).
 *
 * WHICH postings are due, and that each is reminded exactly once per closing date, are decided in the database:
 * `due_job_expiry_reminders` lists them (an open EMPLOYER posting that closes within the next 3 days and has no claim
 * for its current closing date) and `claim_job_expiry_reminder` takes the claim in one statement. This file is the part
 * that cannot live there: finding who to email, minting the token, and sending.
 *
 * ── RECIPIENTS ARE RESOLVED BEFORE THE CLAIM ──────────────────────────────
 *
 * The org's owners (fallback: the person who created the organisation) are looked up and filtered first
 * (src/lib/email/recipient-eligibility.ts: the profile exists and has an email, nothing more). A posting with nobody left to
 * mail is logged with its reason and SKIPPED WITHOUT CLAIMING, so nothing is left behind to block a later run: it is
 * listed again tomorrow and sends the day a recipient exists, until the posting closes. (A claim made first and
 * released afterwards would do the same, but would write and delete a row every day for nothing.)
 *
 * ── CLAIM FIRST, THEN SEND ────────────────────────────────────────────────
 *
 * The other reminder runs here send and then stamp, which is at-least-once: a cron and a manual POST overlapping can
 * both send. This one is meant to be exactly-once, so the claim is the atomic step and only the run that won it sends.
 * A send that fails deletes ITS OWN unsent claim (matched by token hash, so it can never release another run's), and
 * the next run retries; a run that dies mid-way leaves a claim that is treated as abandoned after 30 minutes.
 *
 * ── NO FEATURE FLAG ───────────────────────────────────────────────────────
 *
 * Same as send-verification-reminders and for the same reason: it is transactional, about the employer's own posting,
 * and has no email preference to honour. The migration being applied is the switch.
 *
 * ── THE WINDOW ────────────────────────────────────────────────────────────
 *
 * "Closes within the next 3 days": a run that was missed catches up on the next one, and a job published with 2 days
 * left still gets its one reminder. The claim row, not the window, is what stops a second send.
 *
 * EXTERNAL postings are never listed, claimed or mentioned: the SQL says `source_type = 'internal'` in every function.
 */

export interface ExpiryReminderRunSummary {
  considered: number;
  sent: number;
  failed: number;
  /** Listed but not claimed: nobody eligible to email. Retried on the next run. */
  skipped: number;
  reason?: string;
}

/** Bounded fan-out per run, the same safety cap the other reminder runs use. */
const MAX_POSTINGS_PER_RUN = 200;

type Resolved = { recipients: EmailableRecipient[]; skipped: Array<{ userId: string; reason: RecipientSkipReason }> };

/** The org's owners (owner-role members), else the person who created the organisation. Cached per run. */
async function loadRecipients(
  supabase: ReturnType<typeof createServiceRoleClient>,
  organizationId: string,
  cache: Map<string, Resolved>,
): Promise<Resolved> {
  const cached = cache.get(organizationId);
  if (cached) return cached;

  let userIds: string[] = [];
  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner");
  userIds = (members ?? []).map((m) => m.user_id);

  if (userIds.length === 0) {
    const { data: org } = await supabase
      .from("organizations")
      .select("created_by")
      .eq("id", organizationId)
      .maybeSingle();
    if (org?.created_by) userIds = [org.created_by];
  }

  let profiles: RecipientProfile[] = [];
  if (userIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, email, first_name").in("id", userIds);
    profiles = data ?? [];
  }

  const resolved = selectEmailableRecipients(userIds, profiles);
  cache.set(organizationId, resolved);
  return resolved;
}

export async function sendExpiryReminders(now: Date = new Date()): Promise<ExpiryReminderRunSummary> {
  const base: ExpiryReminderRunSummary = { considered: 0, sent: 0, failed: 0, skipped: 0 };

  const resend = getResendClient();
  if (!resend) {
    console.error("[expiry-reminders] RESEND_API_KEY is not set — cannot send");
    return { ...base, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();
  const { data: due, error: dueError } = await supabase.rpc("due_job_expiry_reminders", {
    p_now: now.toISOString(),
    p_limit: MAX_POSTINGS_PER_RUN,
  });
  if (dueError) {
    console.error("[expiry-reminders] could not list due postings:", dueError.message);
    return { ...base, reason: dueError.message };
  }

  const summary: ExpiryReminderRunSummary = { ...base, considered: (due ?? []).length };
  const recipientCache = new Map<string, Resolved>();

  for (const posting of due ?? []) {
    // Who would we mail? Decided BEFORE anything is claimed, so a posting with nobody to mail leaves no row behind.
    let resolved: Resolved;
    try {
      resolved = await loadRecipients(supabase, posting.organization_id, recipientCache);
    } catch (err) {
      summary.failed++;
      console.error(`[expiry-reminders] could not resolve recipients for ${posting.job_posting_id}:`, err);
      continue;
    }
    if (resolved.recipients.length === 0) {
      const why = resolved.skipped.length > 0 ? resolved.skipped.map((s) => s.reason).join(",") : "no owner found";
      console.info(
        `[expiry-reminders] skipped posting ${posting.job_posting_id}: no eligible recipient (${why}); will retry on the next run`,
      );
      summary.skipped++;
      continue;
    }

    const { token, hash } = generateExtendToken();

    const { data: claimed, error: claimError } = await supabase.rpc("claim_job_expiry_reminder", {
      p_job_posting_id: posting.job_posting_id,
      p_token_hash: hash,
      p_now: now.toISOString(),
    });
    if (claimError) {
      summary.failed++;
      console.error(`[expiry-reminders] claim failed for ${posting.job_posting_id}:`, claimError.message);
      continue;
    }
    // Not ours: another run holds it, or the posting changed since it was listed. Not a failure, and nothing to release.
    if (!claimed || claimed.length === 0) continue;

    const closesAt = claimed[0].closes_at;

    /** Give the claim back so the next run retries. Matched by OUR hash: never touches another run's claim. */
    const release = async () => {
      const { error } = await supabase.from("job_expiry_reminders").delete().eq("token_hash", hash).is("sent_at", null);
      if (error) console.error(`[expiry-reminders] could not release claim for ${posting.job_posting_id}:`, error.message);
    };

    try {
      const extendUrl = absoluteUrl(`/extend-posting/${token}`);
      const jobsUrl = absoluteUrl("/employer/jobs");

      for (const recipient of resolved.recipients) {
        const email = buildExpiryReminderEmail({
          firstName: recipient.firstName,
          title: posting.title,
          closesAt,
          extendUrl,
          jobsUrl,
        });
        await resend.emails.send({
          from: "Talentrah <notifications@talentrah.com>",
          to: recipient.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      }

      // Unchecked, this is the bug this repo has hit before: a send that "succeeded" and was never recorded.
      const { error: stampError } = await supabase
        .from("job_expiry_reminders")
        .update({ sent_at: now.toISOString() })
        .eq("token_hash", hash);
      if (stampError) {
        // The mail is out and the claim row still blocks a second send for this closing date for 30 minutes; after
        // that an unstamped claim could be retaken, so say so loudly rather than quietly double-sending later.
        console.error(`[expiry-reminders] sent but could not stamp ${posting.job_posting_id}:`, stampError.message);
      }
      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error(`[expiry-reminders] failed for ${posting.job_posting_id}:`, err);
      await release();
    }
  }

  console.log(
    `[expiry-reminders] considered=${summary.considered} sent=${summary.sent} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  return summary;
}
