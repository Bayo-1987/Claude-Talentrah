import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { generateExtendToken } from "./token";
import { buildExpiryReminderEmail } from "./template";

/**
 * The daily "your posting closes soon" run (EMP-1 / E3, migration 0205).
 *
 * WHICH postings are due, and that each is reminded exactly once per closing date, are decided in the database:
 * `due_job_expiry_reminders` lists them (an open EMPLOYER posting whose expires_at is in the window below) and
 * `claim_job_expiry_reminder` takes the claim in one statement. This file is the part that cannot live there: minting
 * the token, finding who to email, and sending.
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
 * A posting closing after now + 2 days and at or before now + 3 days + 1 hour: 25 hours wide, so every closing time is
 * inside at least one daily run's window even if cron timing drifts by up to an hour; the claim row stops the overlap
 * hour from sending twice. The reasoning is written out in 0205's header.
 *
 * EXTERNAL postings are never listed, claimed or mentioned: the SQL says `source_type = 'internal'` in every function.
 */

export interface ExpiryReminderRunSummary {
  considered: number;
  sent: number;
  failed: number;
  reason?: string;
}

/** Bounded fan-out per run, the same safety cap the other reminder runs use. */
const MAX_POSTINGS_PER_RUN = 200;

type Recipient = { email: string; firstName: string | null };

/** The org's owners (owner-role members), else the person who created the organisation. Cached per run. */
async function loadRecipients(
  supabase: ReturnType<typeof createServiceRoleClient>,
  organizationId: string,
  cache: Map<string, Recipient[]>,
): Promise<Recipient[]> {
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

  let recipients: Recipient[] = [];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, email, first_name").in("id", userIds);
    recipients = (profiles ?? [])
      .filter((p): p is typeof p & { email: string } => Boolean(p.email))
      .map((p) => ({ email: p.email, firstName: p.first_name }));
  }
  cache.set(organizationId, recipients);
  return recipients;
}

export async function sendExpiryReminders(now: Date = new Date()): Promise<ExpiryReminderRunSummary> {
  const base: ExpiryReminderRunSummary = { considered: 0, sent: 0, failed: 0 };

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
  const recipientCache = new Map<string, Recipient[]>();

  for (const posting of due ?? []) {
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
      const recipients = await loadRecipients(supabase, posting.organization_id, recipientCache);
      if (recipients.length === 0) {
        console.error(`[expiry-reminders] no email on file for the owner(s) of org ${posting.organization_id}`);
        summary.failed++;
        await release();
        continue;
      }

      const extendUrl = absoluteUrl(`/extend-posting/${token}`);
      const jobsUrl = absoluteUrl("/employer/jobs");

      for (const recipient of recipients) {
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

  console.log(`[expiry-reminders] considered=${summary.considered} sent=${summary.sent} failed=${summary.failed}`);
  return summary;
}
