import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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
 * Ported from `openReports()` in /api/admin/moderate-job-posting, grouping and
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

/** Counts for the nav, in one place so the three screens and the shell agree. */
export async function queueCounts(): Promise<{
  scholarships: number;
  reports: number;
  campaigns: number;
}> {
  const [scholarships, reports, campaigns] = await Promise.all([
    pendingScholarships(),
    reportedPostings(),
    pendingCampaigns(),
  ]);
  return {
    scholarships: scholarships.length,
    reports: reports.length,
    campaigns: campaigns.length,
  };
}
