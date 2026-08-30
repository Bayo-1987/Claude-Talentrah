import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { JOB_SOURCES } from "@/lib/jobs/sources.config";
import { externalSourceKey } from "@/lib/jobs/types";
import { MAX_INDETERMINATE_RENEWAL_ATTEMPTS } from "@/lib/billing/renewals";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

/**
 * Operational visibility. READ ONLY — every function here is a SELECT.
 *
 * Nothing in this module writes, and nothing needed a new grant: the service
 * role already reads all of it. That was checked rather than assumed, and it
 * is the reason M5 ships without a migration.
 *
 * WHY THIS SCREEN EXISTS. CLAUDE.md names the risk it covers, in its own
 * words: "the daily cron is now load-bearing for recovery — retrying is the
 * only mechanism, there is no dunning queue and no alert, so a cron that
 * silently stops firing means these Passes never resolve". A Pass sitting in
 * `pending_renewal_reference` is a charge of UNKNOWN outcome against a real
 * card. Until now nothing surfaced one.
 */

export { MAX_INDETERMINATE_RENEWAL_ATTEMPTS };

/* ------------------------------------------------------------------ *
 * Pass renewals in an indeterminate state
 * ------------------------------------------------------------------ */

export interface StuckRenewal {
  id: string;
  userEmail: string | null;
  attempts: number;
  /** True once attempts have hit the ceiling and the Pass will not be retried. */
  exhausted: boolean;
  autoRenewStatus: string | null;
  nextRenewalDate: string | null;
  lastFailureAt: string | null;
  pendingReference: string;
  /** The matching payment row, if one was written before the timeout. */
  transactionStatus: string | null;
}

/**
 * Passes whose last renewal charge has an outcome nobody knows.
 *
 * `pending_renewal_reference` is deliberately never cleared on give-up (0043):
 * it is "the only thread back to the money". So a non-null value means one of
 * two very different things, and the difference is `renewal_attempt_count`:
 *
 *   attempts < 3   still being retried on the daily cron. Fine, watch it.
 *   attempts >= 3  GIVEN UP. The customer may have been debited and lapsed
 *                  anyway, and nothing will resolve it automatically —
 *                  Paystack never answered, three times.
 *
 * The second case is the one this whole screen was worth building for, so it
 * is sorted to the top and counted separately.
 */
export async function stuckRenewals(): Promise<StuckRenewal[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_passes")
    .select(
      "id, renewal_attempt_count, auto_renew_status, next_renewal_date, last_renewal_failure_at, pending_renewal_reference, profiles(email)",
    )
    .not("pending_renewal_reference", "is", null)
    .order("renewal_attempt_count", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  /*
   * The payment row is fetched separately and matched in TypeScript rather
   * than embedded. `payment_transactions.paystack_reference` is not a foreign
   * key to anything — it is Paystack's identifier — so PostgREST has no
   * relationship to traverse. Matching here is the honest version; inventing
   * an FK to make the join expressible would change the schema to suit a
   * screen.
   */
  const references = rows
    .map((r) => r.pending_renewal_reference)
    .filter((r): r is string => r !== null);
  const { data: payments, error: payError } = await supabase
    .from("payment_transactions")
    .select("paystack_reference, status")
    .in("paystack_reference", references);
  if (payError) throw payError;

  const statusByReference = new Map(
    (payments ?? []).map((p) => [p.paystack_reference, p.status]),
  );

  return rows.map((r) => ({
    id: r.id,
    userEmail: r.profiles?.email ?? null,
    attempts: r.renewal_attempt_count,
    exhausted: r.renewal_attempt_count >= MAX_INDETERMINATE_RENEWAL_ATTEMPTS,
    autoRenewStatus: r.auto_renew_status,
    nextRenewalDate: r.next_renewal_date,
    lastFailureAt: r.last_renewal_failure_at,
    pendingReference: r.pending_renewal_reference!,
    transactionStatus: statusByReference.get(r.pending_renewal_reference!) ?? null,
  }));
}

/* ------------------------------------------------------------------ *
 * Auto-Apply queue
 * ------------------------------------------------------------------ */

export interface QueueHealth {
  byStatus: Record<string, number>;
  /** Pending items older than a day — the queue's own definition of stale. */
  stalePending: number;
  oldestPendingAt: string | null;
}

/**
 * Auto-Apply queue health.
 *
 * `handed_off` is not a failure and must not read as one: Auto-Apply never
 * submits to external postings because there is no ATS integration, so an
 * external match is handed to the source site by design. Lumping it with
 * `dismissed` or `expired` would invent a problem.
 *
 * What IS worth seeing is `pending` that has aged. A queue item waits for its
 * user to confirm, so a large pending count is normal; a pending item from
 * last week means the match went unseen.
 */
export async function autoApplyQueueHealth(): Promise<QueueHealth> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("auto_apply_queue")
    .select("status, queued_at");
  if (error) throw error;

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const byStatus: Record<string, number> = {};
  let stalePending = 0;
  let oldestPendingAt: string | null = null;

  for (const row of data ?? []) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.status !== "pending") continue;
    if (new Date(row.queued_at).getTime() < dayAgo) stalePending += 1;
    if (!oldestPendingAt || row.queued_at < oldestPendingAt) oldestPendingAt = row.queued_at;
  }

  return { byStatus, stalePending, oldestPendingAt };
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

export interface RateLimitBucket {
  bucket: string;
  windows: number;
  requests: number;
  distinctUsers: number;
  latestWindowStart: string;
  /** The bucket's configured ceiling, or null if the bucket is not in RATE_LIMITS. */
  limit: number | null;
  /** Windows in which the ceiling was actually reached — i.e. somebody got a 429. */
  windowsAtLimit: number;
  /** Highest count seen in any window, so "12 against a limit of 10" is visible. */
  peak: number;
}

/**
 * Rate-limit activity by bucket, over the last 24 hours.
 *
 * Deliberately aggregated and never per-user. `api_rate_limits` is keyed on
 * user_id, and a screen listing who hit which limit would be a behavioural
 * profile of named people — which is not what an operator needs to answer
 * "is something being throttled". The counts answer that; the names would
 * only tempt someone to act on them.
 *
 * EACH COUNT IS SHOWN AGAINST ITS CONFIGURED CEILING, and that is not a
 * nicety. A raw "12 requests" is unreadable; "12 against a limit of 10" says a
 * request was refused. This suggestion came from the session that spent half a
 * day on a CI failure whose only evidence was an ABSENCE — a 429 returns
 * before the credit charge and before the job_tailoring_requests insert, so a
 * throttled run leaves no ledger row, no request row and no retained log line.
 * The bucket row was the only trace, and a raw number would not have made it
 * obvious.
 *
 * `windowsAtLimit` counts windows that actually reached the ceiling, because
 * that is the thing worth alerting on; `peak` shows how far past it went,
 * since consume_rate_limit keeps counting after it starts refusing.
 */
export async function rateLimitBuckets(): Promise<RateLimitBucket[]> {
  const supabase = createServiceRoleClient();
  /*
   * TRUNCATED TO THE HOUR, and that is not a rounding preference.
   *
   * `window_start` is hour-truncated by consume_rate_limit. Comparing it
   * against a wall-clock `now - 24h` — 13:47, say — silently drops the 13:00
   * window at the far end, so the screen would claim 24 hours and show 23 plus
   * a fragment. The same mismatch, with `>` instead of `>=`, is what made me
   * report "no rate-limit rows at all" during the CI investigation on
   * 2026-08-29: the one window that mattered was exactly on the boundary, and
   * a strict comparison against a truncated column dropped precisely it.
   *
   * A filter that returns plausible-and-empty does not announce itself. On a
   * truncated column, truncate the bound too, and use `>=`.
   */
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  since.setUTCMinutes(0, 0, 0);
  const { data, error } = await supabase
    .from("api_rate_limits")
    .select("bucket, user_id, window_start, request_count")
    .gte("window_start", since.toISOString());
  if (error) throw error;

  const grouped = new Map<
    string,
    { windows: number; requests: number; users: Set<string>; latest: string; atLimit: number; peak: number }
  >();
  for (const row of data ?? []) {
    const configured = (RATE_LIMITS as Record<string, { limit: number } | undefined>)[row.bucket];
    const entry = grouped.get(row.bucket) ?? {
      windows: 0,
      requests: 0,
      users: new Set<string>(),
      latest: row.window_start,
      atLimit: 0,
      peak: 0,
    };
    entry.windows += 1;
    entry.requests += row.request_count;
    entry.users.add(row.user_id);
    if (row.window_start > entry.latest) entry.latest = row.window_start;
    if (configured && row.request_count >= configured.limit) entry.atLimit += 1;
    if (row.request_count > entry.peak) entry.peak = row.request_count;
    grouped.set(row.bucket, entry);
  }

  return [...grouped.entries()]
    .map(([bucket, e]) => ({
      bucket,
      windows: e.windows,
      requests: e.requests,
      distinctUsers: e.users.size,
      latestWindowStart: e.latest,
      limit: (RATE_LIMITS as Record<string, { limit: number } | undefined>)[bucket]?.limit ?? null,
      windowsAtLimit: e.atLimit,
      peak: e.peak,
    }))
    // Throttled buckets first — a bucket that refused somebody is the only
    // one that changes what an operator does next.
    .sort((a, b) => b.windowsAtLimit - a.windowsAtLimit || b.requests - a.requests);
}

/* ------------------------------------------------------------------ *
 * Ingest freshness — DERIVED, with the limits that implies
 * ------------------------------------------------------------------ */

export interface FeedFreshness {
  key: string;
  label: string;
  /** "configured" sources come from sources.config.ts; "observed" only from data. */
  configured: boolean;
  postings: number | null;
  open: number | null;
  lastCheckedAt: string | null;
  hoursSince: number | null;
  /** Employer-posted rows are not ingested at all — never stale, just not a feed. */
  notIngested?: boolean;
}

/**
 * When each feed last refreshed a row.
 *
 * THERE IS NO INGEST-RUN TABLE. Checked: nothing in `public` records runs, so
 * this is derived from `job_postings.last_checked_at` and
 * `scholarships.last_checked_at`, which the ingest writes on every upsert and
 * every close sweep.
 *
 * THE LIMITATION IS REAL AND IS STATED ON THE SCREEN, not just here. A run
 * that fetches successfully and finds nothing new touches no rows, so the
 * timestamp does not move — which is indistinguishable from the cron never
 * having fired. This measures "when this source last refreshed a posting",
 * not "when the ingest last ran". They coincide only while sources keep
 * returning data.
 *
 * A real `ingest_runs` table written by the cron — every run, including the
 * empty ones — is the honest fix and would make this exact rather than
 * indicative. It is a migration and a write path, so it is a documented
 * follow-up rather than part of a read-only milestone.
 *
 * CONFIGURED-BUT-ABSENT SOURCES ARE SHOWN, not omitted. Joining the observed
 * set against JOB_SOURCES turns "a source that has never yielded anything"
 * from an invisible row into a visible "never seen" — which is the failure
 * this screen most needs to catch, and the one a pure GROUP BY would hide.
 */
export async function feedFreshness(): Promise<FeedFreshness[]> {
  const supabase = createServiceRoleClient();

  const { data: postings, error } = await supabase
    .from("job_postings")
    .select("external_source, status, last_checked_at");
  if (error) throw error;

  const observed = new Map<string, { postings: number; open: number; last: string | null }>();
  for (const row of postings ?? []) {
    const key = row.external_source ?? "(internal)";
    const entry = observed.get(key) ?? { postings: 0, open: 0, last: null };
    entry.postings += 1;
    if (row.status === "open") entry.open += 1;
    if (row.last_checked_at && (!entry.last || row.last_checked_at > entry.last)) {
      entry.last = row.last_checked_at;
    }
    observed.set(key, entry);
  }

  const hoursSince = (iso: string | null) =>
    iso === null ? null : Math.round(((Date.now() - new Date(iso).getTime()) / 3_600_000) * 10) / 10;

  const rows: FeedFreshness[] = [];

  // Every configured job source, whether or not it has ever produced a row.
  for (const config of JOB_SOURCES) {
    const key = externalSourceKey(config);
    const seen = observed.get(key);
    observed.delete(key);
    rows.push({
      key,
      label: key,
      configured: true,
      postings: seen?.postings ?? 0,
      open: seen?.open ?? 0,
      lastCheckedAt: seen?.last ?? null,
      hoursSince: hoursSince(seen?.last ?? null),
    });
  }

  // Anything left in the data that is no longer configured — a source removed
  // from the config still has its postings, and hiding them would make an
  // orphaned feed invisible.
  for (const [key, seen] of observed) {
    const internal = key === "(internal)";
    rows.push({
      key,
      label: internal ? "Employer-posted" : key,
      configured: false,
      postings: seen.postings,
      open: seen.open,
      lastCheckedAt: seen.last,
      hoursSince: hoursSince(seen.last),
      // Not a feed and never refreshed by anything. Without this it reads as
      // the most stale source on the page, which is a false alarm — and a
      // dashboard that cries wolf is one nobody reads.
      notIngested: internal,
    });
  }

  const { data: scholarships, error: schError } = await supabase
    .from("scholarships")
    .select("last_checked_at, moderation_status");
  if (schError) throw schError;

  let schLast: string | null = null;
  let schVerified = 0;
  for (const s of scholarships ?? []) {
    if (s.last_checked_at && (!schLast || s.last_checked_at > schLast)) schLast = s.last_checked_at;
    if (s.moderation_status === "verified") schVerified += 1;
  }
  rows.push({
    key: "scholarships",
    label: "Scholarships",
    configured: true,
    postings: scholarships?.length ?? 0,
    open: schVerified,
    lastCheckedAt: schLast,
    hoursSince: hoursSince(schLast),
  });

  return rows;
}

/* ------------------------------------------------------------------ *
 * Credential events on operator accounts
 * ------------------------------------------------------------------ */

export interface OperatorCredentialEvent {
  action: "user_recovery_requested" | "user_modified" | string;
  operatorEmail: string;
  occurredAt: string;
  ip: string | null;
  /**
   * Within the attention window. Computed here rather than in the page: the
   * page is a render path, and `Date.now()` during render is both impure and
   * (lint caught this) forbidden — but it also belongs with the data, because
   * "recent" is what the nav badge counts and the two must not drift.
   */
  recent: boolean;
}

/** Recent enough that a legitimate reset stops being flagged. */
export const CREDENTIAL_EVENT_ATTENTION_DAYS = 7;

/**
 * Password recoveries and account modifications on ADMIN accounts.
 *
 * WHY THIS IS HERE AT ALL. `admin_audit_log` records what an operator DID.
 * Nothing recorded something being done TO an operator's account — and since
 * the seeker forgot-password flow shipped, an admin password is resettable
 * from the public /login page by whoever controls that inbox. That is the
 * ordinary consequence of email recovery rather than a defect, and excluding
 * operators from reset would be worse (an enumeration oracle, plus no recovery
 * for a locked-out operator). What was missing was visibility, which is this.
 *
 * IT READS AN EVENT GOTRUE ALREADY WRITES, so there is no write path of ours
 * to fail, and it is RETROACTIVE — it covers resets that happened before this
 * shipped.
 *
 * The scoping to operators lives in 0067's function body, not here, and is not
 * a parameter: `auth.audit_log_entries` holds events for every user and its
 * payload carries email addresses, so a caller must not be able to widen it.
 *
 * `user_modified` DOES NOT MEAN "the password changed". GoTrue does not record
 * which field moved, so it is surfaced under its own label rather than folded
 * in — an unexplained modification on an operator account is worth a look on
 * its own terms, and conflating the two would turn a real signal into a false
 * claim.
 */
export async function operatorCredentialEvents(): Promise<OperatorCredentialEvent[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("operator_credential_events", {});
  if (error) throw error;

  const cutoff = Date.now() - CREDENTIAL_EVENT_ATTENTION_DAYS * 24 * 60 * 60 * 1000;
  return (data ?? []).map((e) => ({
    action: e.event_action,
    operatorEmail: e.operator_email,
    occurredAt: e.occurred_at,
    ip: e.event_ip ?? null,
    recent: new Date(e.occurred_at).getTime() >= cutoff,
  }));
}

/**
 * What the nav badge counts: things that will not fix themselves.
 *
 * Deliberately NOT "everything unusual". A Pass on attempt 1 of 3 is being
 * retried by the daily cron and needs nobody; counting it would make the badge
 * permanently non-zero and therefore ignorable — the failure mode every other
 * badge here was designed to avoid.
 *
 * Two things qualify, and both need a person:
 *   * a renewal that has exhausted its attempts — a charge of unknown outcome
 *     that nothing will resolve automatically;
 *   * a configured source that has never produced a posting, which is either
 *     a broken integration or a config that was never right.
 */
export async function opsAttentionCount(): Promise<number> {
  const [renewals, feeds, credentials] = await Promise.all([
    stuckRenewals(),
    feedFreshness(),
    operatorCredentialEvents(),
  ]);
  const exhausted = renewals.filter((r) => r.exhausted).length;
  const neverSeen = feeds.filter((f) => f.configured && f.lastCheckedAt === null).length;

  /*
   * Credential events count only while RECENT. An operator who legitimately
   * reset their own password should be noticed, and should stop being flagged
   * a week later — a badge that counts every event forever is permanently
   * non-zero, which is the same as being off.
   */
  const recentCredentialEvents = credentials.filter((e) => e.recent).length;

  return exhausted + neverSeen + recentCredentialEvents;
}
