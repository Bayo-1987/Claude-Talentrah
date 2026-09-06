import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { dueVerificationReminder } from "./due";

/**
 * The "you posted a job while unverified, and still are" reminder run.
 *
 * NO FEATURE FLAG, deliberately different from the digest
 * (src/lib/digest/send.ts), which ships dark behind `isFeatureEnabled`. Two
 * reasons this one doesn't:
 *
 *   - It's transactional, not a growth/marketing send — it tells an org about
 *     a problem with THEIR OWN listing, not a weekly roundup they'd need to
 *     opt into. There is no `email_preferences` toggle for it for the same
 *     reason there isn't one for a password-reset email.
 *   - This migration (the two `*_sent_at` columns) already goes through the
 *     standing "holds for founder review regardless of CI" gate before it
 *     can run anywhere — that IS the human-flips-the-switch checkpoint the
 *     digest's flag provides, just via the migration-approval step instead
 *     of a separate row in `feature_flags`.
 *
 * If a kill switch turns out to be wanted anyway (e.g. to pause sends without
 * a redeploy), `isFeatureEnabled` is a drop-in the same way the digest uses
 * it — flagged here rather than added unasked, since this repo treats an
 * outbound email as something to under-build a switch for, not over-build.
 *
 * IDEMPOTENT THE SAME WAY THE DIGEST IS: each `*_sent_at` column is stamped
 * only after a successful send, so a run that fails partway retries the
 * ones it didn't reach next time rather than skipping them forever, and a
 * cron that somehow fires twice in a day is a no-op the second time for
 * every org it already reached.
 */

export interface VerificationReminderRunSummary {
  considered: number;
  sent48h: number;
  sent7d: number;
  failed: number;
  reason?: string;
}

/** Same shape of safety cap the digest uses — bounded fan-out regardless of how many orgs qualify. */
const MAX_ORGS_PER_RUN = 500;

export async function sendVerificationReminders(
  now: Date = new Date(),
): Promise<VerificationReminderRunSummary> {
  const base: VerificationReminderRunSummary = {
    considered: 0,
    sent48h: 0,
    sent7d: 0,
    failed: 0,
  };

  const resend = getResendClient();
  if (!resend) {
    console.error("[verification-reminders] RESEND_API_KEY is not set — cannot send");
    return { ...base, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();

  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("id, name, created_by, verification_reminder_48h_sent_at, verification_reminder_7d_sent_at")
    .eq("verified", false)
    .limit(MAX_ORGS_PER_RUN);
  if (orgsError) {
    console.error("[verification-reminders] could not read organizations:", orgsError.message);
    return { ...base, reason: orgsError.message };
  }
  if (!orgs || orgs.length === 0) {
    return base;
  }

  // Earliest posting per org, computed in JS rather than a new RPC — the
  // unverified-org count is small (production: 1-2 at a time) and this
  // avoids adding a database function for what is, today, a handful of rows.
  const orgIds = orgs.map((o) => o.id);
  const { data: postings, error: postingsError } = await supabase
    .from("job_postings")
    .select("organization_id, posted_at")
    .in("organization_id", orgIds)
    .eq("source_type", "internal");
  if (postingsError) {
    console.error("[verification-reminders] could not read job_postings:", postingsError.message);
    return { ...base, reason: postingsError.message };
  }

  const earliestPostedAt = new Map<string, string>();
  for (const p of postings ?? []) {
    if (!p.organization_id) continue;
    const existing = earliestPostedAt.get(p.organization_id);
    if (!existing || p.posted_at < existing) earliestPostedAt.set(p.organization_id, p.posted_at);
  }

  const candidates = orgs
    .map((org) => {
      const earliest = earliestPostedAt.get(org.id);
      if (!earliest) return null; // No job posted at all — nothing to remind about.
      const due = dueVerificationReminder({
        now,
        earliestUnverifiedPostedAt: new Date(earliest),
        reminder48hSentAt: org.verification_reminder_48h_sent_at
          ? new Date(org.verification_reminder_48h_sent_at)
          : null,
        reminder7dSentAt: org.verification_reminder_7d_sent_at
          ? new Date(org.verification_reminder_7d_sent_at)
          : null,
      });
      return due ? { org, due } : null;
    })
    .filter((c): c is { org: (typeof orgs)[number]; due: "48h" | "7d" } => c !== null);

  const summary: VerificationReminderRunSummary = { ...base, considered: candidates.length };
  if (candidates.length === 0) return summary;

  const creatorIds = [...new Set(candidates.map((c) => c.org.created_by))];
  const { data: creators, error: creatorsError } = await supabase
    .from("profiles")
    .select("id, email, first_name")
    .in("id", creatorIds);
  if (creatorsError) {
    console.error("[verification-reminders] could not read profiles:", creatorsError.message);
    return { ...summary, reason: creatorsError.message };
  }
  const creatorById = new Map((creators ?? []).map((c) => [c.id, c]));

  for (const { org, due } of candidates) {
    const creator = creatorById.get(org.created_by);
    if (!creator?.email) {
      console.error(`[verification-reminders] no email on file for org ${org.id}'s creator`);
      summary.failed++;
      continue;
    }

    try {
      const email = buildReminderEmail({ orgName: org.name, firstName: creator.first_name, due });
      await resend.emails.send({
        from: "Talentrah <notifications@talentrah.com>",
        to: creator.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      const stampPayload =
        due === "48h"
          ? { verification_reminder_48h_sent_at: now.toISOString() }
          : { verification_reminder_7d_sent_at: now.toISOString() };
      const { error: stampError } = await supabase
        .from("organizations")
        .update(stampPayload)
        .eq("id", org.id);
      if (stampError) {
        // Unchecked, this is exactly the bug this repo has hit before: a send
        // that "succeeded" and then re-sends the same reminder every day
        // because nothing ever recorded that it went out.
        console.error(`[verification-reminders] sent but could not stamp org ${org.id}:`, stampError.message);
      }

      if (due === "48h") summary.sent48h++;
      else summary.sent7d++;
    } catch (err) {
      summary.failed++;
      console.error(`[verification-reminders] failed for org ${org.id}:`, err);
    }
  }

  console.log(
    `[verification-reminders] considered=${summary.considered} sent48h=${summary.sent48h} ` +
      `sent7d=${summary.sent7d} failed=${summary.failed}`,
  );
  return summary;
}

function buildReminderEmail(args: {
  orgName: string;
  firstName: string | null;
  due: "48h" | "7d";
}): { subject: string; text: string; html: string } {
  const greeting = args.firstName ? `Hi ${args.firstName},` : "Hi,";
  const profileUrl = absoluteUrl("/employer/profile");

  const body =
    args.due === "48h"
      ? `${args.orgName} isn't verified yet, so the job you posted isn't showing up in the public feed. This usually takes a minute to fix — add your company's work-email domain on your Company Profile and it verifies automatically once your account email matches it.`
      : `It's been a week, and ${args.orgName} is still unverified — your posting still isn't reaching candidates. If you're stuck (a mismatched email, a personal address, anything else), reply to this email and we'll help sort it out.`;

  const subject =
    args.due === "48h"
      ? `${args.orgName}'s job isn't public yet`
      : `Still unverified: ${args.orgName}'s posting isn't reaching candidates`;

  const text = `${greeting}\n\n${body}\n\nCompany Profile: ${profileUrl}\n\n— Talentrah`;
  const html = `<p>${greeting}</p><p>${body}</p><p><a href="${profileUrl}">Company Profile</a></p><p>— Talentrah</p>`;

  return { subject, text, html };
}
