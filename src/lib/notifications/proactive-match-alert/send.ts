import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { isFeatureEnabled } from "@/lib/flags/read";
import { computeMatchScore } from "@/lib/matching/score";
import { filterListablePostings, type RawScoredPosting } from "@/lib/digest/send";
import { buildProactiveAlertEmail, buildProactiveAlertInApp } from "./template";
import {
  candidateIsEligible,
  pickBestJobForCandidate,
  type ProactiveAlertCandidate,
  type ScoredNewJob,
} from "./select";
import type { StructuredResume } from "@/lib/resume/types";
import type { SeniorityLevel } from "@/lib/jobs/types";

/**
 * send-138 — the run this alert fires from.
 *
 * ── WHY THIS HOOKS INTO INGESTION, NOT A NEW SCHEDULE ─────────────────────
 *
 * §6.10 asks for this to trigger off match-score (re)computation, not a
 * second scan of the same data. The honest finding, checked before building
 * anything: match scores in THIS codebase are computed lazily, per visitor,
 * when a user loads /jobs or a job detail page (compute-and-store.ts) — there
 * is no existing background recompute a genuinely proactive alert could hook
 * into, because by definition the person this alert is FOR is not visiting.
 *
 * So this hooks into the other side of the same fact: a match score changes
 * only when either the resume or the posting changes, and a NOT-actively-
 * searching user's resume is not changing every three hours — new POSTINGS
 * are. `sinceIso` is the caller's own ingestion-run-start timestamp
 * (src/app/api/admin/ingest-jobs/route.ts), and this only ever scores this
 * run's newly-INSERTED postings (`job_postings.created_at >= sinceIso`)
 * against the candidate pool — never a full re-scan of every posting against
 * every user. `created_at` is untouched by ingest's own upsert for an
 * existing row (see ingest.ts — the upsert payload never includes it), so
 * this window can never re-catch an already-seen posting on a later run.
 *
 * ── THE THREE SWITCHES, CHECKED IN THE SAME ORDER AS THE DIGEST ───────────
 *
 *   feature_flags.proactive_match_alert      does the product send at all
 *   email_preferences.proactive_match_alert  does THIS PERSON want it
 *   RESEND_API_KEY                           can we send anything
 *
 * Exactly digest/send.ts's own three gates, on this alert's own flag and
 * preference column rather than reusing the digest's.
 */

export interface ProactiveAlertRunSummary {
  enabled: boolean;
  newPostings: number;
  consideredCandidates: number;
  sent: number;
  failed: number;
  reason?: string;
}

/** Bounded for the same reason the digest bounds itself — see its own note. */
const MAX_CANDIDATES_PER_RUN = 200;
/** New postings scored per run; a real ingest cycle sees a handful, per the
 * digest's own measured ~3.6/day mean — this is headroom, not an expectation. */
const MAX_NEW_POSTINGS_PER_RUN = 50;

export async function sendProactiveMatchAlerts(
  sinceIso: string,
  now: Date = new Date(),
): Promise<ProactiveAlertRunSummary> {
  const base: ProactiveAlertRunSummary = {
    enabled: false,
    newPostings: 0,
    consideredCandidates: 0,
    sent: 0,
    failed: 0,
  };

  if (!(await isFeatureEnabled("proactive_match_alert"))) {
    console.log("[proactive-match-alert] feature flag off — no work done");
    return { ...base, reason: "feature flag off" };
  }

  const resend = getResendClient();
  if (!resend) {
    console.error("[proactive-match-alert] RESEND_API_KEY is not set — cannot send");
    return { ...base, enabled: true, reason: "mailer not configured" };
  }

  const supabase = createServiceRoleClient();

  const newPostings = await loadNewListablePostings(supabase, sinceIso);
  if (newPostings.length === 0) {
    return { ...base, enabled: true, reason: "no new postings this run" };
  }

  const candidates = await loadCandidates(supabase);
  const summary: ProactiveAlertRunSummary = {
    ...base,
    enabled: true,
    newPostings: newPostings.length,
    consideredCandidates: candidates.length,
  };

  for (const candidate of candidates) {
    if (!candidateIsEligible(candidate, now)) continue;

    try {
      const resume = await loadBaseResume(supabase, candidate.userId);
      if (!resume) continue; // hasBaseResume said yes but the row vanished mid-run; skip rather than crash the loop

      const scored: ScoredNewJob[] = newPostings.map((p) => {
        const structuredJd = p.structuredJd as { skills?: string[] } | null;
        const result = computeMatchScore(resume, structuredJd?.skills ?? [], p.seniority ?? undefined);
        return {
          jobId: p.jobId,
          title: p.title,
          companyName: p.companyName,
          location: p.location,
          score: result.score,
        };
      });

      const best = pickBestJobForCandidate(scored);
      if (!best) continue;

      /*
       * THE LOCK. Inserted BEFORE anything is sent, and success is what
       * authorises sending — not the other way round. Two overlapping runs
       * (a manual trigger racing the cron, say) both reaching this line for
       * the same (user, job) pair can only have one INSERT succeed; the
       * loser's unique-violation is treated as "already handled", not an
       * error. This is the one database statement that decides "has this
       * exact alert already fired", matching this codebase's own standing
       * rule that a gate must check-and-act atomically rather than read then
       * write.
       */
      const { error: lockError } = await supabase
        .from("proactive_match_alerts")
        .insert({ user_id: candidate.userId, job_posting_id: best.jobId, score: best.score });
      if (lockError) {
        if (lockError.code === "23505") continue; // unique violation — someone else's run already claimed this pair
        throw lockError;
      }

      const inApp = buildProactiveAlertInApp(best);
      const { error: notifError } = await supabase.from("user_notifications").insert({
        user_id: candidate.userId,
        type: "proactive_match_alert",
        title: inApp.title,
        body: inApp.body,
        link: inApp.link,
      });
      if (notifError) {
        // Logged, not fatal to the email send below — an in-app row failing
        // to write must not also cost the person the email itself.
        console.error("[proactive-match-alert] in-app notification write failed:", notifError.message);
      }

      const email = buildProactiveAlertEmail({
        firstName: candidate.firstName,
        job: best,
        unsubscribeToken: candidate.unsubscribeToken,
      });
      await resend.emails.send({
        from: "Farah at Talentrah <farah@talentrah.com>",
        to: candidate.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error("[proactive-match-alert] failed for", candidate.userId, err);
    }
  }

  console.log(
    `[proactive-match-alert] newPostings=${summary.newPostings} ` +
      `consideredCandidates=${summary.consideredCandidates} sent=${summary.sent} failed=${summary.failed}`,
  );
  return summary;
}

interface NewListablePosting extends RawScoredPosting {
  structuredJd: unknown;
  seniority: SeniorityLevel | null;
}

async function loadNewListablePostings(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sinceIso: string,
): Promise<NewListablePosting[]> {
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, title, company_name, location, posted_at, status, organization_id, unlisted_at, structured_jd, seniority")
    .eq("status", "open")
    .gte("created_at", sinceIso)
    .limit(MAX_NEW_POSTINGS_PER_RUN);
  if (error) throw error;

  const raw: NewListablePosting[] = (data ?? []).map((j) => ({
    jobId: j.id,
    title: j.title,
    companyName: j.company_name,
    location: j.location,
    score: 0, // unused by filterListablePostings; RawScoredPosting's shape requires it
    postedAt: j.posted_at,
    organizationId: j.organization_id,
    unlistedAt: j.unlisted_at,
    structuredJd: j.structured_jd,
    seniority: j.seniority,
  }));
  if (raw.length === 0) return [];

  const organizationIds = Array.from(
    new Set(raw.map((p) => p.organizationId).filter((id): id is string => id !== null)),
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

  // filterListablePostings is digest/send.ts's own pure gate (0109-class
  // check: verified-or-external, never unlisted) — reused rather than
  // re-derived, exactly as this file's own header says.
  return filterListablePostings(raw, verifiedOrganizationIds) as NewListablePosting[];
}

async function loadCandidates(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<(ProactiveAlertCandidate & { unsubscribeToken: string })[]> {
  const { data: recipients, error } = await supabase
    .from("email_preferences")
    .select("user_id, unsubscribe_token, profiles!inner(email, first_name)")
    .eq("proactive_match_alert", true)
    .limit(MAX_CANDIDATES_PER_RUN);
  if (error) throw error;
  if (!recipients || recipients.length === 0) return [];

  const userIds = recipients.map((r) => r.user_id);

  const [{ data: baseResumeUsers, error: resumesError }, { data: activity, error: activityError }, { data: lastAlerts, error: alertsError }] =
    await Promise.all([
      // Existence only — the full resume is fetched once, per eligible
      // candidate, by loadBaseResume below. Most of this batch will fail the
      // activity/rate-limit gates and never need the actual content, so
      // pulling every candidate's full structured_content here would be a
      // JSONB blob loaded into memory for nothing, up to MAX_CANDIDATES_PER_RUN
      // times over.
      supabase.from("resumes").select("user_id").eq("is_base", true).in("user_id", userIds),
      supabase.from("match_scores").select("user_id, computed_at").in("user_id", userIds),
      supabase.from("proactive_match_alerts").select("user_id, sent_at").in("user_id", userIds),
    ]);
  if (resumesError) throw resumesError;
  if (activityError) throw activityError;
  if (alertsError) throw alertsError;

  const usersWithBaseResume = new Set((baseResumeUsers ?? []).map((r) => r.user_id));

  const lastActiveByUser = new Map<string, string>();
  for (const row of activity ?? []) {
    const current = lastActiveByUser.get(row.user_id);
    if (!current || row.computed_at > current) lastActiveByUser.set(row.user_id, row.computed_at);
  }

  const lastAlertByUser = new Map<string, string>();
  for (const row of lastAlerts ?? []) {
    const current = lastAlertByUser.get(row.user_id);
    if (!current || row.sent_at > current) lastAlertByUser.set(row.user_id, row.sent_at);
  }

  return recipients
    .map((r) => {
      const profile = r.profiles as unknown as { email: string; first_name: string | null };
      if (!profile?.email) return null;
      return {
        userId: r.user_id,
        email: profile.email,
        firstName: profile.first_name,
        unsubscribeToken: r.unsubscribe_token,
        hasBaseResume: usersWithBaseResume.has(r.user_id),
        lastActiveAt: lastActiveByUser.get(r.user_id) ?? null,
        lastAlertSentAt: lastAlertByUser.get(r.user_id) ?? null,
      };
    })
    .filter((c): c is ProactiveAlertCandidate & { unsubscribeToken: string } => c !== null);
}

async function loadBaseResume(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
): Promise<StructuredResume | null> {
  const { data, error } = await supabase
    .from("resumes")
    .select("structured_content")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();
  if (error) throw error;
  return (data?.structured_content as StructuredResume | null) ?? null;
}
