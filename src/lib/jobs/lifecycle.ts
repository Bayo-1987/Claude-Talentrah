import "server-only";

/**
 * JOBS-LIFECYCLE-1, stage 1: the READ-ONLY half of the job lifecycle: the flags, the classes of posting, and the dry run (W0).
 *
 * THIS MODULE WRITES NOTHING. It has no insert, update, delete, upsert or rpc call, on purpose and by test (tests/jobs/lifecycle-dry-run.test.ts reads this file and fails if one appears): the dry run
 * answers "what WOULD a lifecycle run close and delete, and what stops it", and a dry run that changes anything is not one. It does not even write a job_posting_lifecycle_runs row.
 *
 * WHAT IS BUILT IN THIS STAGE: the nightly delete is guarded (posting-deletion.ts, W-1, no flag: it only reduces what is deleted) and this dry run. NOT BUILT: closing sheet imports (W1), the new
 * deletes (W2, W3), the tombstone reads in the sheet planner and ingest, the 7-day default, retiring the 30-day rule (W4). The two flags below ship OFF and the waves, when they are built, call
 * lifecycleWaveAllowed first; with them off nothing new closes or deletes.
 *
 * THE CLASSES (the owner's SQL in the accepted plan, section 2g, defines them the same way):
 *   sheet          external_source starts "manual-" (a jobs-sheet import)
 *   aggregator     every other external posting (an ATS or schema.org source); already closed by the 72-hour presence rule
 *   employer       an internal posting an employer wrote
 *   employer_feed  an internal posting imported through an employer's feed (import_feed_id)
 * The two employer classes are OUT OF SCOPE of every new rule (Reviewer ruling, 14 Nov 2026): the dry run shows their counts and nothing else.
 */

/** The admin permission that may run the dry run. The existing jobs-import permission (0276): the people who load jobs are the people who need to see what would leave. Proposed; a new one needs approval. */
export const LIFECYCLE_DRY_RUN_PERMISSION = "jobs_import";

export const LIFECYCLE_FLAG_KEYS = {
  closeImports: "job_lifecycle_close_imports",
  deleteUnreferenced: "job_lifecycle_delete_unreferenced",
} as const;

/** A sheet import with no stated deadline is closed this many days after it was created (W1, not built here). */
export const SHEET_NO_DEADLINE_DAYS = 7;
/** A closed posting is eligible for the new delete this many hours after it closed (W2 and W3, not built here). */
export const UNREFERENCED_CLOSED_HOURS = 24;

/**
 * The BLOCKING references: the tables job_posting_delete_unreferenced (0279) checks. A closed posting any of these points at is kept. The five EXEMPT tables (match_scores, country_default_events,
 * apply_link_clicks, proactive_match_alerts, job_expiry_reminders) are not here: their rows go with the job. tests/jobs/lifecycle-dry-run.test.ts holds this list equal to the one the migration's
 * own test uses, and tests/rls/job-posting-lifecycle-delete.test.ts holds that one equal to the live catalog.
 */
export const BLOCKING_REFERENCES: ReadonlyArray<readonly [table: string, column: string]> = [
  ["ad_campaigns", "job_posting_id"],
  ["ad_events", "job_posting_id"],
  ["applicant_messages", "job_posting_id"],
  ["application_assessment_submissions", "job_posting_id"],
  ["applications", "job_posting_id"],
  ["auto_apply_queue", "job_posting_id"],
  ["employer_applicant_notifications", "job_posting_id"],
  ["interview_bookings", "job_posting_id"],
  ["interview_offers", "job_posting_id"],
  ["job_posting_assessments", "job_posting_id"],
  ["job_posting_reports", "job_posting_id"],
  ["job_posting_screening_questions", "job_posting_id"],
  ["job_postings", "superseded_by"],
  ["job_tailoring_requests", "source_job_posting_id"],
  ["resumes", "tailored_for_job_id"],
];

export type PostingClass = "sheet" | "aggregator" | "employer" | "employer_feed";

export function classOfPosting(p: { source_type: string; external_source: string | null; import_feed_id: string | null }): PostingClass {
  if (p.source_type === "internal") return p.import_feed_id ? "employer_feed" : "employer";
  return p.external_source?.startsWith("manual-") ? "sheet" : "aggregator";
}

export const OUT_OF_SCOPE_CLASSES: readonly PostingClass[] = ["employer", "employer_feed"];

export interface LifecycleFlags {
  closeImports: boolean;
  deleteUnreferenced: boolean;
}

/** Whether a wave may run. Every wave that closes or deletes something NEW (W1, W2, W3) calls this first; with the flag off the answer is no. */
export function lifecycleWaveAllowed(flags: LifecycleFlags, wave: "close_imports" | "delete_unreferenced"): boolean {
  return wave === "close_imports" ? flags.closeImports === true : flags.deleteUnreferenced === true;
}

/** The slice of the Supabase client this module uses: selects only. */
export interface ReadQuery extends PromiseLike<{ data: unknown[] | null; count?: number | null; error: { message: string } | null }> {
  eq(column: string, value: unknown): ReadQuery;
  not(column: string, operator: string, value: unknown): ReadQuery;
  lt(column: string, value: unknown): ReadQuery;
  like(column: string, pattern: string): ReadQuery;
  or(filters: string): ReadQuery;
  in(column: string, values: readonly string[]): ReadQuery;
  order(column: string): ReadQuery;
  range(from: number, to: number): ReadQuery;
}
export interface LifecycleReadClient {
  from(table: string): { select(columns: string, options?: { count?: "exact"; head?: boolean }): ReadQuery };
}

/** A missing row, a missing table or any error reads as OFF: a flag that cannot be read must not switch anything on. */
export async function readLifecycleFlags(client: LifecycleReadClient): Promise<LifecycleFlags> {
  const keys = Object.values(LIFECYCLE_FLAG_KEYS);
  const { data, error } = await client.from("feature_flags").select("key, enabled").in("key", keys);
  if (error) return { closeImports: false, deleteUnreferenced: false };
  const on = new Set((data as Array<{ key: string; enabled: boolean }> | null ?? []).filter((r) => r.enabled === true).map((r) => r.key));
  return { closeImports: on.has(LIFECYCLE_FLAG_KEYS.closeImports), deleteUnreferenced: on.has(LIFECYCLE_FLAG_KEYS.deleteUnreferenced) };
}

export interface ClassDeleteReport {
  /** Closed more than UNREFERENCED_CLOSED_HOURS ago. */
  eligible: number;
  /** Of those, kept because a blocking table references them. */
  blocked: number;
  /** eligible - blocked: what a delete wave would remove. */
  would_delete: number;
  /** Per blocking table, how many eligible postings it references (a posting referenced twice counts under each table). */
  blocked_by: Record<string, number>;
}

export interface DryRunReport {
  generated_at: string;
  flags: LifecycleFlags;
  thresholds: { sheet_no_deadline_days: number; unreferenced_closed_hours: number };
  /** W1: open sheet imports with no stated deadline (expires_at_source null or 'default') created more than the threshold ago. */
  would_close: { sheet: number };
  /** W2 and W3: closed postings with nothing blocking, by class. */
  would_delete: { sheet: ClassDeleteReport; aggregator: ClassDeleteReport };
  /** Count only. Nothing new is built for these classes. */
  out_of_scope: { employer: { eligible: number }; employer_feed: { eligible: number } };
  /** True when the eligible set was longer than the read limit: the numbers are a lower bound. */
  truncated: boolean;
}

const PAGE = 1000;
const MAX_PAGES = 10;
const IN_CHUNK = 200;

class ReadFailed extends Error {}
const must = <T extends { error: { message: string } | null }>(r: T): T => {
  if (r.error) throw new ReadFailed(r.error.message);
  return r;
};

export async function lifecycleDryRun(client: LifecycleReadClient, now: Date = new Date()): Promise<DryRunReport> {
  const sheetCutoff = new Date(now.getTime() - SHEET_NO_DEADLINE_DAYS * 86_400_000).toISOString();
  const closedCutoff = new Date(now.getTime() - UNREFERENCED_CLOSED_HOURS * 3_600_000).toISOString();

  const flags = await readLifecycleFlags(client);

  // W1: the same predicate as the owner's SQL (2g, query 2, first line).
  const closeCount = must(
    await client
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .like("external_source", "manual-%")
      .or("expires_at_source.is.null,expires_at_source.eq.default")
      .lt("created_at", sheetCutoff),
  ).count ?? 0;

  // W2 and W3: the closed postings older than the threshold, in pages, in a fixed order.
  const eligible: Array<{ id: string; source_type: string; external_source: string | null; import_feed_id: string | null }> = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = must(
      await client
        .from("job_postings")
        .select("id, source_type, external_source, import_feed_id")
        .eq("status", "closed")
        .not("closed_at", "is", null)
        .lt("closed_at", closedCutoff)
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE - 1),
    );
    const rows = (data ?? []) as typeof eligible;
    eligible.push(...rows);
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const byClass: Record<PostingClass, string[]> = { sheet: [], aggregator: [], employer: [], employer_feed: [] };
  for (const row of eligible) byClass[classOfPosting(row)].push(row.id);

  // For the two in-scope classes only: which eligible postings does each blocking table reference?
  const inScope = [...byClass.sheet, ...byClass.aggregator];
  const referencedBy = new Map<string, Set<string>>(); // table -> ids
  for (const [table, column] of BLOCKING_REFERENCES) {
    const hit = new Set<string>();
    for (let i = 0; i < inScope.length; i += IN_CHUNK) {
      const chunk = inScope.slice(i, i + IN_CHUNK);
      const { data } = must(await client.from(table).select(column).in(column, chunk));
      for (const r of (data ?? []) as Array<Record<string, string | null>>) if (r[column]) hit.add(r[column] as string);
    }
    referencedBy.set(table, hit);
  }

  const reportFor = (ids: string[]): ClassDeleteReport => {
    const blockedIds = new Set<string>();
    const blocked_by: Record<string, number> = {};
    for (const [table] of BLOCKING_REFERENCES) {
      const hits = ids.filter((id) => referencedBy.get(table)?.has(id));
      if (hits.length) blocked_by[table] = (blocked_by[table] ?? 0) + hits.length;
      for (const id of hits) blockedIds.add(id);
    }
    return { eligible: ids.length, blocked: blockedIds.size, would_delete: ids.length - blockedIds.size, blocked_by };
  };

  return {
    generated_at: now.toISOString(),
    flags,
    thresholds: { sheet_no_deadline_days: SHEET_NO_DEADLINE_DAYS, unreferenced_closed_hours: UNREFERENCED_CLOSED_HOURS },
    would_close: { sheet: closeCount },
    would_delete: { sheet: reportFor(byClass.sheet), aggregator: reportFor(byClass.aggregator) },
    out_of_scope: { employer: { eligible: byClass.employer.length }, employer_feed: { eligible: byClass.employer_feed.length } },
    truncated,
  };
}

export interface AdminLike {
  permissions: readonly string[];
}

export interface DryRunDeps {
  getAdmin(): Promise<AdminLike | null>;
  /** The service-role client, asked for ONLY after the permission check passes. */
  service(): LifecycleReadClient | Promise<LifecycleReadClient>;
  now(): Date;
  log(errorClass: string): void;
}

const MESSAGES = {
  bad_origin: "That request did not come from this site.",
  not_signed_in: "Sign in to the admin area.",
  missing_permission: "You do not have the jobs import permission.",
  read_failed: "The database could not be read. Nothing was changed. Try again.",
} as const;

function reply(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const refuse = (code: keyof typeof MESSAGES, status: number) => reply({ ok: false, code, message: MESSAGES[code] }, status);

/**
 * POST /admin/job-lifecycle/dry-run. A HUMAN-operated route, so its guard is the ADMIN SESSION, not the shared secret (docs/admin-auth.md): the request must come from this site's own origin, the
 * identity comes from the admin session only (none: 401), and it must hold LIFECYCLE_DRY_RUN_PERMISSION (403). Nothing is read from the request body and nothing is written anywhere, not even an
 * audit row: a denied attempt is answered and that is all. A failure answers an error CLASS, never the database's own text.
 */
export async function handleDryRun(request: Request, deps: DryRunDeps): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin) return refuse("bad_origin", 403);
  const admin = await deps.getAdmin();
  if (!admin) return refuse("not_signed_in", 401);
  if (!admin.permissions.includes(LIFECYCLE_DRY_RUN_PERMISSION)) return refuse("missing_permission", 403);
  try {
    const report = await lifecycleDryRun(await deps.service(), deps.now());
    return reply({ ok: true, report }, 200);
  } catch (e) {
    deps.log(e instanceof ReadFailed ? "read_failed" : "unexpected");
    return refuse("read_failed", 500);
  }
}
