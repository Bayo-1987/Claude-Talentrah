import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { placeholderCourseCount } from "@/lib/admin/catalog/courses";
import { opsAttentionCount } from "@/lib/admin/ops/queries";
import { financialHealth } from "@/lib/admin/finance/queries";

/**
 * The three queues, read for the dashboard.
 *
 * These deliberately duplicate the GET halves of /api/admin/moderate-* rather
 * than calling them over HTTP. Calling our own route would mean re-presenting
 * the admin session as a shared secret to get back in, which is the exact
 * indirection M1 removed — and it would put a network hop between a Server
 * Component and a database it can already reach.
 *
 * The API routes stay as they are. They are the machine-operable surface and
 * are still the only way to act on any of this with curl; nothing here removes
 * them, and M2 changes none of their behaviour.
 *
 * Service role throughout, because that is the point: every one of these
 * queues is rows that RLS hides from every normal session — unpublished
 * scholarships, write-only reports, other organisations' campaigns.
 */

export interface PendingScholarship {
  id: string;
  provider: string;
  programName: string;
  deadline: string | null;
  url: string;
  lastCheckedAt: string | null;
}

export async function pendingScholarships(): Promise<PendingScholarship[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("scholarships")
    .select("id, provider, program_name, application_deadline, official_url, last_checked_at")
    .eq("moderation_status", "pending")
    .order("last_checked_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    provider: r.provider,
    programName: r.program_name,
    deadline: r.application_deadline,
    url: r.official_url,
    lastCheckedAt: r.last_checked_at,
  }));
}

export interface ReportedPosting {
  jobPostingId: string;
  title: string;
  company: string;
  status: string;
  sourceType: string;
  externalUrl: string | null;
  /** Distinct PEOPLE, not clicks — 0057's unique constraint is what makes that true. */
  reportCount: number;
  reasons: Record<string, number>;
  latestAt: string;
  details: string[];
}

/**
 * Postings with open reports, ranked by how many distinct people reported them.
 *
 * Ported from `openReports()` in the since-deleted
 * /api/admin/moderate-job-posting, grouping and
 * ordering unchanged — including WHY it groups in TypeScript: PostgREST cannot
 * express "count distinct reporters per posting, ordered by that count", and
 * the alternatives put the queue's shape into a migration. At this table's
 * volume the grouping is free. If it ever needs paging it needs an RPC, and
 * that is the signal to write one rather than to add a LIMIT.
 *
 * A report is "open" while the posting it names is still on the board; there
 * is no per-report status column. Consequence worth knowing rather than
 * discovering: restoring a posting brings its old reports back into this
 * queue, because they were never retracted.
 */
export async function reportedPostings(): Promise<ReportedPosting[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("job_posting_reports")
    // One contiguous literal — supabase-js parses this at the TYPE level, and
    // a concatenation is just `string` to the compiler, which collapses every
    // row to GenericStringError.
    .select(
      "job_posting_id, reason, details, created_at, job_postings!inner(title, company_name, status, source_type, external_url)",
    )
    .neq("job_postings.status", "removed")
    .order("created_at", { ascending: false });

  if (error) throw error;

  type Row = NonNullable<typeof data>[number];
  const grouped = new Map<string, ReportedPosting>();

  for (const row of (data ?? []) as Row[]) {
    // `!inner` guarantees the join, but typegen models a to-one embed as
    // possibly-null and is right to. Skip rather than assert.
    const posting = row.job_postings;
    if (!posting) continue;

    const entry = grouped.get(row.job_posting_id) ?? {
      jobPostingId: row.job_posting_id,
      title: posting.title,
      company: posting.company_name,
      status: posting.status,
      sourceType: posting.source_type,
      externalUrl: posting.external_url,
      reportCount: 0,
      reasons: {} as Record<string, number>,
      // Rows arrive newest-first, so the first seen for a posting is its most
      // recent report.
      latestAt: row.created_at,
      details: [] as string[],
    };

    entry.reportCount += 1;
    entry.reasons[row.reason] = (entry.reasons[row.reason] ?? 0) + 1;
    if (row.details) entry.details.push(row.details);
    grouped.set(row.job_posting_id, entry);
  }

  return [...grouped.values()].sort(
    (a, b) => b.reportCount - a.reportCount || b.latestAt.localeCompare(a.latestAt),
  );
}

export interface RemovedPosting {
  jobPostingId: string;
  title: string;
  company: string;
  sourceType: string;
  removedAt: string | null;
  removalReason: string | null;
  /** The operator who removed it, resolved to a name. Null for pre-0064 removals. */
  removedByName: string | null;
}

/**
 * Postings currently removed from the board.
 *
 * THIS EXISTS BECAUSE RESTORE WAS UNREACHABLE. `reportedPostings()` filters
 * `status != 'removed'`, and the restore action's precondition is
 * `status = 'removed'` — mutually exclusive. So the Restore button rendered on
 * every row of the reports queue could never succeed, and every posting that
 * could be restored had already dropped out of the list. The UI had a restore
 * ACTION and no restore PATH; the shared-secret route was the only thing that
 * could actually un-remove a posting.
 *
 * Shipped that way in M2 and not caught, because the round trip was never
 * tested — only the remove half was. tests/rls/job-posting-restore.test.ts is
 * the assertion that would have caught it, added with this.
 *
 * Deliberately NOT merged into reportedPostings(). These are two different
 * questions — "what are people complaining about" and "what have we taken
 * down" — and a single list mixing them would make the reports queue's count
 * mean two things at once.
 */
export async function removedPostings(): Promise<RemovedPosting[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("job_postings")
    .select(
      "id, title, company_name, source_type, removed_at, removal_reason, profiles!job_postings_removed_by_fkey(first_name, last_name)",
    )
    .eq("status", "removed")
    .order("removed_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r) => {
    const who = r.profiles;
    const name = who ? [who.first_name, who.last_name].filter(Boolean).join(" ").trim() : "";
    return {
      jobPostingId: r.id,
      title: r.title,
      company: r.company_name,
      sourceType: r.source_type,
      removedAt: r.removed_at,
      removalReason: r.removal_reason,
      removedByName: name || null,
    };
  });
}

export interface PendingCampaign {
  id: string;
  name: string;
  dailyRateNgn: number;
  totalBudgetNgn: number | null;
  submittedAt: string | null;
  organisation: { name: string; domain: string | null; verified: boolean } | null;
  posting: { title: string; location: string | null } | null;
}

export async function pendingCampaigns(): Promise<PendingCampaign[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select(
      "id, name, daily_rate_ngn, total_budget_ngn, submitted_at, organizations(name, domain, verified), job_postings(title, location)",
    )
    .eq("status", "pending_review")
    .order("submitted_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    dailyRateNgn: r.daily_rate_ngn,
    totalBudgetNgn: r.total_budget_ngn,
    submittedAt: r.submitted_at,
    organisation: r.organizations
      ? {
          name: r.organizations.name,
          domain: r.organizations.domain,
          verified: r.organizations.verified,
        }
      : null,
    posting: r.job_postings
      ? { title: r.job_postings.title, location: r.job_postings.location }
      : null,
  }));
}

export type FeedbackStatus = "new" | "in_review" | "resolved" | "declined";

export interface FeedbackItem {
  id: string;
  category: string;
  message: string;
  pagePath: string | null;
  createdAt: string;
  status: FeedbackStatus;
  triagedAt: string | null;
  triageNote: string | null;
  /** The operator who last changed the status, resolved to a display name. */
  triagedByName: string | null;
}

/**
 * Feedback awaiting triage.
 *
 * WHAT IS NOT SHOWN, and it is the whole reason this queue took a migration
 * rather than a SELECT: nothing about the person who wrote it. `feedback` is a
 * write-only mailbox (0054) precisely because it carries other people's words
 * about the product, their employer, and sometimes us. Reading it as an
 * operator is a legitimate need; identifying the author to act on their words
 * is a different one, and this screen does not have it. `user_id` is not
 * selected at all — not selected-and-hidden, which is one careless render away
 * from being shown.
 *
 * The consequence is deliberate and worth stating: an operator cannot reply to
 * feedback from here, because they cannot see who sent it. Following up needs
 * a decision about contacting users that nobody has made yet, and a queue that
 * quietly exposed every author's identity would have made it by default.
 *
 * `profiles` is joined ONLY for the triaging admin's own name — an operator,
 * not a user, and someone whose name belongs on their own decision.
 */
export async function feedbackQueue(
  statuses: FeedbackStatus[] = ["new", "in_review"],
): Promise<FeedbackItem[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("feedback")
    .select(
      "id, category, message, page_path, created_at, status, triaged_at, triage_note, profiles!feedback_triaged_by_fkey(first_name, last_name)",
    )
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((r) => {
    const triager = r.profiles;
    const name = triager
      ? [triager.first_name, triager.last_name].filter(Boolean).join(" ").trim()
      : "";
    return {
      id: r.id,
      category: r.category,
      message: r.message,
      pagePath: r.page_path,
      createdAt: r.created_at,
      status: r.status as FeedbackStatus,
      triagedAt: r.triaged_at,
      triageNote: r.triage_note,
      triagedByName: name || null,
    };
  });
}

/** Counts for the nav, in one place so the screens and the shell agree. */
export async function queueCounts(): Promise<{
  scholarships: number;
  reports: number;
  campaigns: number;
  feedback: number;
  courses: number;
  ops: number;
  finance: number;
}> {
  const [scholarships, reports, campaigns, feedback, courses, ops, finance] =
    await Promise.all([
    pendingScholarships(),
    reportedPostings(),
    pendingCampaigns(),
    // Untriaged only. Counting `in_review` here would make the badge stop
    // falling as an operator works through the queue, which is the one thing
    // a count on a nav is for.
    feedbackQueue(["new"]),
    // Not the row count. Every other badge means "this much is waiting", and a
    // catalog has nothing waiting — but an un-curated affiliate link IS
    // outstanding work (§10 item 1), so this counts those and falls to 0 when
    // real codes land.
    placeholderCourseCount(),
    // Only what will not fix itself — see opsAttentionCount.
    opsAttentionCount(),
    // Payments whose outcome nobody has learned. NOT total payments — a badge
    // counting healthy activity never falls, so it never means anything.
    financialHealth(),
  ]);
  return {
    scholarships: scholarships.length,
    reports: reports.length,
    campaigns: campaigns.length,
    feedback: feedback.length,
    courses,
    ops,
    finance: finance.pendingCount,
  };
}
