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
 * A scored posting before the digest's own listing gate has run — see
 * `filterListablePostings` below for why this gate exists at all.
 */
export interface RawScoredPosting {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  score: number;
  postedAt: string;
  /** Null for an external posting — those have no organisation to verify. */
  organizationId: string | null;
  /** Non-null once a private share link was minted for this posting (0107). */
  unlistedAt: string | null;
}

/**
 * The digest's own copy of the public-listing gate.
 *
 * `loadCandidates` below runs on the SERVICE ROLE client, which bypasses RLS
 * entirely. Every OTHER listing surface (the feed, `search_job_postings`,
 * the sitemap, the SEO landing pages) gets `organizations.verified` enforced
 * for free by the `job postings are publicly readable` policy (0027, 0107) —
 * this one does not, because nothing here ever evaluates that policy. This
 * function is that check, done by hand, matching 0109's reasoning for
 * `promoted_jobs`: a proactive surface — an email a person did not ask to see
 * right now — must clear at least the bar an organic listing does, not less.
 *
 * `match_scores` rows do not expire when verification does. The whole finding
 * behind 0109 was that they outlive it: `saveCompanyProfileAction` re-runs
 * verification in BOTH directions when an organisation's domain changes, so a
 * posting that was scored while verified can keep a stale score row long
 * after the org verifies away. Trusting an existing `match_scores` row as
 * proof the posting was ever safe to surface is exactly the assumption that
 * produced the bug this function closes.
 *
 * A posting with `unlistedAt` set is excluded outright, with no
 * `is_org_member`-style exception the way the feed and search make for an
 * org viewing its own draft (0108). The digest has no such member-facing
 * purpose — its recipient is a job seeker, not the org managing the
 * posting — so there is no reason for an unlisted posting to ever reach a
 * digest email, verified org or not: a digest is precisely the kind of
 * proactive surfacing `unlisted_at` exists to avoid.
 *
 * Pure and exported so this is testable without a database, matching this
 * repo's own convention (`selectDigestJobs`, `getJobShareVisibility`).
 */
export function filterListablePostings(
  postings: RawScoredPosting[],
  verifiedOrganizationIds: ReadonlySet<string>,
): RawScoredPosting[] {
  return postings.filter((p) => {
    if (p.unlistedAt) return false;
    if (p.organizationId === null) return true; // external — nothing to verify
    return verifiedOrganizationIds.has(p.organizationId);
  });
}

/**
 * The week's scored, unacted-on, PUBLICLY LISTABLE postings for one person.
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
    .select(
      "score, job_posting_id, job_postings!inner(id, title, company_name, location, posted_at, status, organization_id, unlisted_at)",
    )
    .eq("user_id", userId)
    .eq("job_postings.status", "open")
    .gte("job_postings.posted_at", since);
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

  const rawPostings: RawScoredPosting[] = (data ?? []).map((row) => {
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
    };
  });
  if (rawPostings.length === 0) return [];

  // Only the organisation ids the digest actually needs to check — an
  // external posting (null organization_id) has nothing to verify.
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
  if (listable.length === 0) return [];

  const jobIds = listable.map((p) => p.jobId);

  /*
   * Two reasons a job is not news, queried the same way: saved/applied means
   * the person has already seen it; already surfaced by send-138's own
   * proactive "exceptional match" alert means Farah already told them about
   * it directly, which is a stronger version of the same fact. Folded into
   * one `alreadyActedOn` flag rather than a second field — the digest's own
   * silence rule (selectDigestJobs) only ever asks "has this been dealt with
   * already", not which mechanism dealt with it, so a second field would be
   * a distinction nothing downstream reads.
   */
  const [{ data: acted, error: actedError }, { data: alerted, error: alertedError }] = await Promise.all([
    supabase.from("applications").select("job_posting_id").eq("user_id", userId).in("job_posting_id", jobIds),
    supabase.from("proactive_match_alerts").select("job_posting_id").eq("user_id", userId).in("job_posting_id", jobIds),
  ]);
  if (actedError) throw actedError;
  if (alertedError) throw alertedError;
  const seen = new Set([
    ...(acted ?? []).map((a) => a.job_posting_id),
    ...(alerted ?? []).map((a) => a.job_posting_id),
  ]);

  return listable.map((p) => ({
    jobId: p.jobId,
    title: p.title,
    companyName: p.companyName,
    location: p.location,
    score: p.score,
    postedAt: p.postedAt,
    alreadyActedOn: seen.has(p.jobId),
  }));
}
