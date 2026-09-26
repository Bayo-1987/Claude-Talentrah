import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { getReferralUrl } from "@/lib/referrals/url";
import { buildHiredMomentEmail } from "./template";

/**
 * send-465 — best-effort email for the exact moment `updateStageAction`
 * (src/lib/applications/tracker-actions.ts) successfully moves an
 * application to "hired".
 *
 * BEST-EFFORT ON EMAIL, same framing as mentorship/notifications.ts's own
 * header comment and billing/renewals.ts's sendReminderEmail: this repo has
 * no general notification pipeline, Resend is wired ad hoc per feature, and
 * a missing RESEND_API_KEY (or any other failure in here) must not block the
 * thing this email is ABOUT — the stage change and the redirect it's called
 * from have already succeeded in the database by the time this runs. This
 * function therefore never throws; every failure is caught and logged.
 *
 * NOT GATED ON `email_preferences`, deliberately, and checked before writing
 * this rather than assumed: `email_preferences` currently has exactly two
 * per-user opt-out columns (`job_match_digest`, `proactive_match_alert`),
 * both for recurring, opt-outable notification STREAMS a person might want
 * to turn off independently of using the feature at all. This send is a
 * direct, one-off consequence of an action the user themselves just took
 * (marking their own application "hired") — the same category
 * `talent-directory/contact-email.ts` and `employer-verification-reminders/
 * send.ts` describe in their own header comments for why THEY skip a
 * preference column too. There is no more an opt-out for this than there is
 * for a password-reset email.
 *
 * NO `user_notifications` ROW: `HiredReferralBanner` already covers the
 * in-app surface for this exact moment (rendered from the `justHired` query
 * param `updateStageAction`'s redirect sets), so writing a second one here
 * would be a competing, duplicate in-app notification for the same event.
 */
export async function sendHiredMomentEmail({
  userId,
  applicationId,
}: {
  userId: string;
  applicationId: string;
}): Promise<void> {
  try {
    const resend = getResendClient();
    if (!resend) {
      console.error("[hired-moment] RESEND_API_KEY is not set — hired-moment email not sent");
      return;
    }

    const supabase = createServiceRoleClient();

    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .select("job_posting_id, manual_job_snapshot, job_postings(title, company_name)")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (applicationError) throw applicationError;
    if (!application) {
      console.error(`[hired-moment] application ${applicationId} not found for user ${userId} — nothing to send`);
      return;
    }

    const resolved = resolveJobInfo(application);
    if (!resolved) {
      console.error(
        `[hired-moment] application ${applicationId} has neither a job_postings row nor a usable manual_job_snapshot — nothing to send`,
      );
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email, first_name, referral_code")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.email) {
      console.error(`[hired-moment] user ${userId} has no email on file — hired-moment email not sent`);
      return;
    }
    if (!profile.referral_code) {
      console.error(`[hired-moment] user ${userId} has no referral_code on file — hired-moment email not sent`);
      return;
    }

    const referralUrl = await getReferralUrl(profile.referral_code);
    const email = buildHiredMomentEmail({
      firstName: profile.first_name,
      jobTitle: resolved.title,
      companyName: resolved.companyName,
      referralUrl,
    });

    await resend.emails.send({
      from: "Farah at Talentrah <farah@talentrah.com>",
      to: profile.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch (err) {
    console.error(`[hired-moment] sendHiredMomentEmail(${userId}, ${applicationId}) failed:`, err);
  }
}

interface JobInfo {
  title: string;
  companyName: string;
}

interface ApplicationForLookup {
  job_posting_id: string | null;
  manual_job_snapshot: unknown;
  job_postings: { title: string; company_name: string } | null;
}

/**
 * Resolves title/company from either a real `job_postings` row (joined via
 * `job_posting_id` — a many-to-one embed, so `job_postings` comes back as a
 * single nullable object here, same as `src/app/(app)/tracker/page.tsx`'s own
 * `row.job_postings` read) or `manual_job_snapshot` (manual tracker entries
 * have no `job_posting_id` at all — see `addManualEntryAction` in
 * tracker-actions.ts for the exact shape it writes:
 * `{ companyName, title, url?, location? }`). Content and asks are identical
 * either way — only this lookup differs.
 */
function resolveJobInfo(application: ApplicationForLookup): JobInfo | null {
  const posting = application.job_postings;
  if (posting?.title && posting?.company_name) {
    return { title: posting.title, companyName: posting.company_name };
  }

  const snapshot = application.manual_job_snapshot as { title?: string; companyName?: string } | null;
  if (snapshot?.title && snapshot?.companyName) {
    return { title: snapshot.title, companyName: snapshot.companyName };
  }

  return null;
}
