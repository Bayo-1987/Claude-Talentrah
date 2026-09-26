import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export interface NotifySeekerResumeViewedParams {
  applicationId: string;
  seekerId: string;
  jobTitle: string;
  companyName: string;
}

/**
 * send-464 — tell the seeker the moment an employer opens their resume, not
 * just show the passive Job Tracker badge 0126 already built.
 *
 * ONLY EVER CALL THIS WHEN record_employer_resume_view (0195) RETURNED TRUE —
 * i.e. THIS call was the one that just set first_viewed_at for the first
 * time. The real call site (resume/page.tsx) checks that return value before
 * reaching this function at all, so a repeat view of the same application
 * never gets here, and neither does the RPC's own silent no-op path (a
 * non-member caller, or an application with no resume attached never even
 * calls record_employer_resume_view). This function itself does not
 * re-derive "was this the first view" — that check happened once, atomically,
 * inside the RPC's own single SQL statement (0195's own header on why a
 * second, JS-side check here would be exactly the read-then-act race
 * CLAUDE.md warns against), so it always sends when called.
 *
 * SAME SHAPE AND SAME GUARANTEE AS mentorship/notifications.ts's
 * notifySessionConfirmed: a guaranteed `user_notifications` row (service-role
 * — RLS on that table has no INSERT policy for anyone else), a best-effort
 * Resend email gated on email_preferences.employer_resume_view, and this
 * NEVER throws. The employer's page has already rendered the resume and
 * their own request has already completed by the time this runs (the real
 * call site fires it inside `after()`, next/server's established pattern in
 * this repo — src/lib/applications/actions.ts's own ad-event and
 * country-default `after()` blocks — for a side effect that must not add
 * latency to, or fail, the caller's response), so a notification failure here
 * must never surface to the employer and must never have been on their
 * response's critical path in the first place.
 */
export async function notifySeekerResumeViewed({
  applicationId,
  seekerId,
  jobTitle,
  companyName,
}: NotifySeekerResumeViewedParams): Promise<void> {
  const supabase = createServiceRoleClient();
  try {
    const title = jobTitle || "a job you applied to";
    const company = companyName || "The employer";

    await writeInAppNotification(supabase, seekerId, {
      title: "Your resume was viewed",
      body: `${company} opened your resume for ${title}. See it in your Job Tracker.`,
      link: "/tracker",
    });

    const resend = getResendClient();
    if (!resend) {
      console.error(
        `[employer-resume-view-notify] RESEND_API_KEY is not set — email not sent for application ${applicationId}, in-app notice still written`,
      );
      return;
    }

    /*
     * email_preferences is service-role-only (0083 — RLS with zero policies,
     * `revoke all ... from anon, authenticated`), so this join is only
     * reachable from exactly the client this function already holds. A
     * missing row would mean no preference has ever been recorded for this
     * user — 0083's own trigger backfills one on every profiles INSERT, so
     * that should not happen, but `.maybeSingle()` treats it as "don't send"
     * rather than throwing, the same fail-closed shape digest/send.ts uses
     * for a missing/errored preference read.
     */
    const { data: prefRow, error: prefError } = await supabase
      .from("email_preferences")
      .select("employer_resume_view, profiles!inner(email, first_name)")
      .eq("user_id", seekerId)
      .maybeSingle();
    if (prefError) {
      console.error(`[employer-resume-view-notify] preference lookup failed for ${seekerId}:`, prefError.message);
      return;
    }
    if (!prefRow?.employer_resume_view) return; // opted out, or no preference row at all

    const profile = prefRow.profiles as unknown as { email: string | null; first_name: string | null };
    if (!profile?.email) {
      console.error(`[employer-resume-view-notify] seeker ${seekerId} has no email on file — email not sent`);
      return;
    }

    const name = profile.first_name || "there";
    const trackerUrl = absoluteUrl("/tracker");
    const subject = `${company} viewed your resume`;
    const text = `Hi ${name},\n\n${company} opened your resume for ${title}.\n\nSee it in your Job Tracker: ${trackerUrl}\n\n— Talentrah`;
    const bodyHtml = [
      emailParagraph(`Hi ${escEmail(name)},`),
      emailParagraph(`${escEmail(company)} opened your resume for ${escEmail(title)}.`),
      emailButton("View your Job Tracker", trackerUrl),
      emailParagraph("— Talentrah"),
    ].join("\n");
    const html = renderBrandedEmail({ bodyHtml });

    try {
      await resend.emails.send({
        from: "Talentrah <notifications@talentrah.com>",
        to: profile.email,
        subject,
        text,
        html,
      });
    } catch (err) {
      console.error(`[employer-resume-view-notify] email failed for application ${applicationId}:`, err);
    }
  } catch (err) {
    console.error(`[employer-resume-view-notify] notifySeekerResumeViewed(${applicationId}) failed:`, err);
  }
}

async function writeInAppNotification(
  supabase: ServiceClient,
  userId: string,
  notification: { title: string; body: string; link: string },
) {
  const { error } = await supabase.from("user_notifications").insert({
    user_id: userId,
    type: "employer_resume_view",
    title: notification.title,
    body: notification.body,
    link: notification.link,
  });
  // Logged, not fatal — same reasoning mentorship/notifications.ts's own
  // writeInAppNotification states: an in-app row failing to write must not
  // also cost the person the email attempt below.
  if (error) console.error("[employer-resume-view-notify] in-app write failed:", error.message);
}
