import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { isFeatureEnabled } from "@/lib/flags/read";
import { filterListablePostings, type RawScoredPosting } from "@/lib/digest/send";
import { MIN_DIGEST_SCORE } from "@/lib/digest/select";
import { buildWinbackEmail } from "./template";
import {
  selectWinbackContent,
  winbackCandidateIsEligible,
  type WinbackCandidate,
  type WinbackMatchedPosting,
} from "./select";

/**
 * send-467's win-back cron run — see select.ts's own header for why this is
 * a SEPARATE send from the proactive "exceptional match" alert rather than a
 * fold-in: a calendar trigger, not an ingest-event trigger, and the two must
 * stay independently controllable (own flag, own preference, own dedup —
 * 0198).
 *
 * ── THE THREE SWITCHES, SAME SHAPE AS THE DIGEST AND THE PROACTIVE ALERT ───
 *
 *   feature_flags.win_back_email          does the product send at all
 *   email_preferences.win_back_email      does THIS PERSON want it
 *   RESEND_API_KEY                        can we send anything
 *
 * ── WHERE THE "WHAT'S NEW" CONTENT COMES FROM ──────────────────────────────
 *
 * `match_scores` — the same table the digest and the proactive alert both
 * read, kept populated for every user with a base resume by
 * `refresh-job.ts`'s daily recompute. That job's own side effect
 * (`computed_at` moving) is exactly what broke the OTHER alert's dormancy
 * check (0197's own header) — but the SCORES it writes are correct and
 * exactly the right input here: this run does not recompute anything, it
 * just reads what the existing recompute already produced since the
 * candidate went dormant.
 */
export interface WinbackRunSummary {
  enabled: boolean;
  consideredCandidates: number;
  sent: number;
  skippedNoPostings: number;
  failed: number;
  reason?: string;
}

/** Bounded for the same reason the digest and proactive alert bound
 * themselves — see either of their own notes. */
const MAX_CANDIDATES_PER_RUN = 200;

export async function sendWinbackEmails(now: Date = new Date()): Promise<WinbackRunSummary> {
  const base: WinbackRunSummary = {
    enabled: false,
    consideredCandidates: 0,
    sent: 0,
    skippedNoPostings: 0,
    failed: 0,
  };

  if (!(await isFeatureEnabled("win_back_email"))) {
    console.log("[win-back] feature flag off — no work done");
    return { ...base, reason: "feature flag off" };
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[win-back] RESEND_API_KEY is not set — cannot send");
    return { ...base, enabled: true, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();

  const allCandidates = await loadCandidates(supabase);
  const eligible = allCandidates.filter((c) => winbackCandidateIsEligible(c, now));

  const summary: WinbackRunSummary = { ...base, enabled: true, consideredCandidates: eligible.length };

  for (const candidate of eligible) {
    try {
      // Guaranteed non-null: winbackCandidateIsEligible already refused a
      // null lastActiveAt (see select.ts's own header on why null has no
      // "since" to measure a window from).
      const sinceIso = candidate.lastActiveAt!;
      const matched = await loadMatchedPostingsSince(supabase, candidate.userId, sinceIso);
      const content = selectWinbackContent(matched);

      if (!content) {
        // Nothing new to report is a silent skip, not a failure — matches
        // the digest's own "a quiet week is a silent week" rule, applied to
        // an episode instead of a week. Deliberately does NOT stamp
        // win_back_last_sent_at: nothing was sent, so this user stays
        // eligible on tomorrow's run for as long as the window (0197/select.ts)
        // still holds.
        summary.skippedNoPostings++;
        continue;
      }

      const email = buildWinbackEmail({
        firstName: candidate.firstName,
        content,
        unsubscribeToken: candidate.unsubscribeToken,
      });

      await resend.emails.send({
        from: "Farah at Talentrah <farah@talentrah.com>",
        to: candidate.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrlFor(candidate.unsubscribeToken)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      // Stamped only after a successful send — same reasoning as the digest's
      // own `digest_last_sent_at`: a failure here retries on the next run
      // instead of being silently treated as done.
      const { error: stampError } = await supabase
        .from("email_preferences")
        .update({ win_back_last_sent_at: now.toISOString() })
        .eq("user_id", candidate.userId);
      if (stampError) {
        // A rejected UPDATE resolves with an error, it does not throw
        // (CLAUDE.md's own standing lesson) — unchecked, this is the bug
        // that re-mails the same person every day for the rest of the
        // window.
        console.error("[win-back] sent but could not stamp", candidate.userId, stampError.message);
      }

      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error("[win-back] failed for", candidate.userId, err);
    }
  }

  console.log(
    `[win-back] consideredCandidates=${summary.consideredCandidates} sent=${summary.sent} ` +
      `skippedNoPostings=${summary.skippedNoPostings} failed=${summary.failed}`,
  );
  return summary;
}

/** Mirrors digest/send.ts's own `unsubscribeUrlFor` — the same URL
 * template.ts already builds for the in-body link, built again here only for
 * the List-Unsubscribe HEADER, so the two can never drift apart. */
function unsubscribeUrlFor(token: string): string {
  return absoluteUrl(`/unsubscribe?token=${encodeURIComponent(token)}&pref=win_back_email`);
}

async function loadCandidates(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<(WinbackCandidate & { unsubscribeToken: string })[]> {
  const { data: recipients, error } = await supabase
    .from("email_preferences")
    .select(
      "user_id, unsubscribe_token, win_back_last_sent_at, profiles!inner(email, first_name, last_active_at)",
    )
    .eq("win_back_email", true)
    .limit(MAX_CANDIDATES_PER_RUN);
  if (error) throw error;
  if (!recipients || recipients.length === 0) return [];

  const userIds = recipients.map((r) => r.user_id);
  const { data: baseResumeUsers, error: resumesError } = await supabase
    .from("resumes")
    .select("user_id")
    .eq("is_base", true)
    .in("user_id", userIds);
  if (resumesError) throw resumesError;
  const usersWithBaseResume = new Set((baseResumeUsers ?? []).map((r) => r.user_id));

  return recipients
    .map((r) => {
      const profile = r.profiles as unknown as {
        email: string;
        first_name: string | null;
        last_active_at: string | null;
      };
      if (!profile?.email) return null;
      return {
        userId: r.user_id,
        email: profile.email,
        firstName: profile.first_name,
        unsubscribeToken: r.unsubscribe_token,
        hasBaseResume: usersWithBaseResume.has(r.user_id),
        lastActiveAt: profile.last_active_at,
        lastWinbackSentAt: r.win_back_last_sent_at,
      };
    })
    .filter((c): c is WinbackCandidate & { unsubscribeToken: string } => c !== null);
}

/**
 * One eligible candidate's listable Good/Excellent matches scored since
 * `sinceIso` (their `last_active_at`) — same listing gate as the digest
 * (`filterListablePostings`, 0109-class: verified-or-external, never
 * unlisted), reused rather than re-derived. `MIN_DIGEST_SCORE` (70) is the
 * same Good+ floor the digest itself uses — "matching their base resume's
 * scored-Excellent/Good tier" per this send's own spec is that floor, not a
 * bespoke one.
 */
async function loadMatchedPostingsSince(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  sinceIso: string,
): Promise<WinbackMatchedPosting[]> {
  const { data, error } = await supabase
    .from("match_scores")
    .select(
      "score, explanation, job_posting_id, job_postings!inner(id, title, company_name, location, posted_at, status, organization_id, unlisted_at)",
    )
    .eq("user_id", userId)
    .eq("job_postings.status", "open")
    .gte("job_postings.posted_at", sinceIso)
    .gte("score", MIN_DIGEST_SCORE);
  if (error) throw error;

  type JoinedJob = {
    id: string;
    title: string;
    company_name: string;
    location: string | null;
    posted_at: string;
    organization_id: string | null;
    unlisted_at: string | null;
  };

  type ScoredPostingWithExplanation = RawScoredPosting & { explanation: unknown };

  const rawPostings: ScoredPostingWithExplanation[] = (data ?? []).map((row) => {
    const job = row.job_postings as unknown as JoinedJob;
    return {
      jobId: job.id,
      title: job.title,
      companyName: job.company_name,
      location: job.location,
      score: row.score,
      postedAt: job.posted_at,
      organizationId: job.organization_id,
      unlistedAt: job.unlisted_at,
      explanation: row.explanation,
    };
  });
  if (rawPostings.length === 0) return [];

  const organizationIds = Array.from(
    new Set(rawPostings.map((p) => p.organizationId).filter((id): id is string => id !== null)),
  );
  let verifiedOrganizationIds = new Set<string>();
  if (organizationIds.length > 0) {
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .in("id", organizationIds)
      .eq("verified", true);
    if (orgError) throw orgError;
    verifiedOrganizationIds = new Set((orgs ?? []).map((o) => o.id));
  }

  const listable = filterListablePostings(rawPostings, verifiedOrganizationIds);

  return listable.map((p) => ({
    jobId: p.jobId,
    title: p.title,
    companyName: p.companyName,
    location: p.location,
    score: p.score,
    explanation: p.explanation,
  }));
}
