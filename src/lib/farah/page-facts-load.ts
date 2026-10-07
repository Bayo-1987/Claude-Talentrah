import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuotaState as realGetQuotaState } from "@/lib/auto-apply/queue";
import { describeScholarship } from "@/lib/scholarships/farah";
import { isScholarshipOpen, scholarshipCloseInstant } from "@/lib/scholarships/close-instant";
import { loadPublicScholarship } from "@/lib/scholarships/public";
import type { Database, Tables } from "@/lib/supabase/types";
import { buildPageFacts, type OpenScholarship, type PageFacts, type PageFactsInput, type ScoredJob, type TopMatch, type TrackedApplication } from "./page-facts";
import type { FarahFactsKind } from "./chip-registry";

/**
 * The loaders behind the page facts. Everything about THIS user is read through the signed-in session client the caller hands in (never the service role), so the database's own row level security decides
 * what is visible and the explicit `user_id` filter is a second lock, not the only one. Every id is validated as a uuid before it reaches a query, what is listed is what is current (open postings, open
 * scholarships), every read is capped, and a failed read is reported as "could not be loaded", never as an empty result.
 *
 * The one exception to "the session client" is the Auto-Apply count, which is the Auto-Apply page's own function (getQuotaState) called with this user's id; it is passed in so a test can replace it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (s: string | undefined): s is string => s !== undefined && UUID.test(s);

const TOP_MATCHES = 5;
const OPEN_SCHOLARSHIPS_LISTED = 8;
const SCHOLARSHIPS_READ = 60;
const APPLICATIONS_READ = 15;
const DAY_MS = 86_400_000;

type Client = SupabaseClient<Database>;
type Row = Record<string, unknown>;
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

async function loadTopMatches(supabase: Client, userId: string): Promise<{ ok: boolean; top: TopMatch[] }> {
  const { data, error } = await supabase
    .from("match_scores")
    .select("score, explanation, job_postings!inner(title, company_name, status)")
    .eq("user_id", userId)
    .eq("job_postings.status", "open")
    .order("score", { ascending: false })
    .limit(TOP_MATCHES);
  if (error) return { ok: false, top: [] };
  const top: TopMatch[] = [];
  for (const r of asRows(data)) {
    const job = (Array.isArray(r.job_postings) ? r.job_postings[0] : r.job_postings) as { title?: string; company_name?: string } | null;
    if (typeof r.score !== "number" || !job?.title) continue;
    top.push({ score: r.score, explanation: r.explanation, title: job.title, companyName: job.company_name ?? "" });
  }
  return { ok: true, top };
}

async function loadOpenScholarships(supabase: Client, now: Date): Promise<{ ok: boolean; open: OpenScholarship[] }> {
  const { data, error } = await supabase
    .from("scholarships")
    .select("program_name, provider, application_deadline, close_tz, close_time")
    .order("application_deadline", { ascending: true, nullsFirst: false })
    .limit(SCHOLARSHIPS_READ);
  if (error) return { ok: false, open: [] };
  const open = asRows(data)
    .filter((r) => isScholarshipOpen({ application_deadline: r.application_deadline as string | null, close_tz: r.close_tz as string | null, close_time: r.close_time as string | null }, now))
    .map((r) => ({ r, at: scholarshipCloseInstant({ application_deadline: r.application_deadline as string | null, close_tz: r.close_tz as string | null, close_time: r.close_time as string | null })?.getTime() ?? Infinity }))
    .sort((a, b) => a.at - b.at)
    .slice(0, OPEN_SCHOLARSHIPS_LISTED)
    .map(({ r }) => ({ programName: String(r.program_name), provider: String(r.provider), deadline: (r.application_deadline as string | null) ?? null }));
  return { ok: true, open };
}

function applicationView(r: Row, now: Date): TrackedApplication | null {
  const job = (Array.isArray(r.job_postings) ? r.job_postings[0] : r.job_postings) as { title?: string; company_name?: string } | null;
  const manual = r.manual_job_snapshot as { title?: string; companyName?: string } | null;
  const title = job?.title ?? manual?.title;
  if (!title) return null;
  const changed = typeof r.updated_at === "string" ? Date.parse(r.updated_at) : NaN;
  return { title, companyName: job?.company_name ?? manual?.companyName ?? "", stage: String(r.stage), daysSinceChange: Number.isFinite(changed) ? Math.max(0, Math.floor((now.getTime() - changed) / DAY_MS)) : 0 };
}

export async function loadPageFacts(args: {
  kind: Exclude<FarahFactsKind, "billing">;
  /** The signed-in user's own session client. */
  supabase: Client;
  userId: string;
  ids: { jobId?: string; scholarshipId?: string; applicationId?: string };
  now?: Date;
  getQuotaState?: typeof realGetQuotaState;
}): Promise<PageFacts> {
  const { supabase, userId, ids } = args;
  const now = args.now ?? new Date();
  let input: PageFactsInput;

  switch (args.kind) {
    case "jobs": {
      let thisJob: ScoredJob | null | undefined;
      let ok = true;
      if (isId(ids.jobId)) {
        const { data, error } = await supabase.from("match_scores").select("score, explanation").eq("user_id", userId).eq("job_posting_id", ids.jobId).maybeSingle();
        if (error) ok = false;
        else thisJob = data && typeof data.score === "number" ? { score: data.score, explanation: data.explanation } : null;
      }
      const t = await loadTopMatches(supabase, userId);
      input = { kind: "jobs", thisJob, top: t.top, unavailable: !ok || !t.ok };
      break;
    }
    case "scholarships": {
      const list = await loadOpenScholarships(supabase, now);
      let detailText: string | undefined;
      let detailOpen: boolean | undefined;
      if (isId(ids.scholarshipId)) {
        const row = await loadPublicScholarship(ids.scholarshipId, supabase);
        if (row) {
          detailText = describeScholarship(row as unknown as Tables<"scholarships">);
          detailOpen = isScholarshipOpen({ application_deadline: row.application_deadline, close_tz: row.close_tz, close_time: row.close_time }, now);
        }
      }
      input = { kind: "scholarships", open: list.open, detailText, detailOpen, unavailable: !list.ok };
      break;
    }
    case "resume-builder": {
      const t = await loadTopMatches(supabase, userId);
      input = { kind: "resume-builder", topRoles: t.top.map((m) => ({ title: m.title, companyName: m.companyName })), unavailable: !t.ok };
      break;
    }
    case "tracker": {
      const sel = "stage, updated_at, manual_job_snapshot, job_postings(title, company_name)";
      const { data, error } = await supabase.from("applications").select(sel).eq("user_id", userId).order("updated_at", { ascending: false }).limit(APPLICATIONS_READ);
      let focus: TrackedApplication | undefined;
      if (!error && isId(ids.applicationId)) {
        const one = await supabase.from("applications").select(sel).eq("id", ids.applicationId).eq("user_id", userId).maybeSingle();
        if (!one.error && one.data) focus = applicationView(one.data as unknown as Row, now) ?? undefined;
      }
      input = { kind: "tracker", applications: error ? [] : asRows(data).map((r) => applicationView(r, now)).filter((a): a is TrackedApplication => a !== null), focus, unavailable: !!error };
      break;
    }
    case "auto-apply": {
      try {
        const q = await (args.getQuotaState ?? realGetQuotaState)(userId);
        input = { kind: "auto-apply", quota: { submittedLast7d: q.submittedLast7d, freeRemaining: q.freeRemaining, dailyRemaining: q.dailyRemaining, nextSubmissionCostsCredits: q.nextSubmissionCostsCredits, nextSubmissionCovered: q.nextSubmissionCovered } };
      } catch {
        input = { kind: "auto-apply", quota: null, unavailable: true };
      }
      break;
    }
    case "tailor":
    case "mentorship":
    case "talent-directory":
    case "refer":
      input = { kind: args.kind };
      break;
  }
  return buildPageFacts(input);
}
