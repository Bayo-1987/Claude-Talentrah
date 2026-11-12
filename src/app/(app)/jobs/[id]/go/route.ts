import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkApplyLink } from "@/lib/jobs/apply-link";
import { isLinkOutPosting } from "@/lib/jobs/link-out";

/**
 * GET /jobs/{id}/go: the redirect behind "Apply on company site" (PR-E4). It takes the job id and NOTHING else: no address in the request, no session read, no cookie, no user id stored.
 *
 * It serves ONLY a job that is an open, internal job whose apply_link_kind is set (a row whose link comes from an import keeps its own anchor and never comes here). It reads the row with the
 * service role (no API role can select the address), looks up the company as it is NOW, and RE-RUNS the validator: a company unverified since the link was saved, a domain that changed, or an
 * address that no longer passes sends the seeker back to the job page with a plain message ("?applyLink=recheck-failed"), never a bare 404 and never the address.
 *
 * The click is counted after the response has left (next/server `after`), best-effort: a failure of the counter is swallowed and never delays or blocks the redirect. HEAD and prefetch requests are
 * ignored: no read, no redirect, no count. Every answer is no-store and noindex.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

function isPrefetch(request: Request): boolean {
  const h = request.headers;
  return /prefetch/i.test(h.get("purpose") ?? "") || /prefetch/i.test(h.get("sec-purpose") ?? "") || h.has("next-router-prefetch") || /prefetch/i.test(h.get("x-moz") ?? "");
}

/** A relative Location on purpose: the seeker stays on this site, and nothing about the stored address can be in it. */
function back(to: string): Response {
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: to } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (isPrefetch(request)) return new Response(null, { status: 204, headers: HEADERS });
  const { id } = await params;
  if (!UUID.test(id)) return back("/jobs");
  const unavailable = `/jobs/${id}?applyLink=recheck-failed`;

  const admin = createServiceRoleClient();
  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .select("id, organization_id, status, source_type, import_feed_id, removed_at, superseded_at, apply_link, apply_link_kind")
    .eq("id", id)
    .maybeSingle();
  if (jobError) {
    console.error("[go] could not read the job:", jobError.message);
    return back(unavailable);
  }
  // An imported posting (the link-out predicate) and a superseded one (replaced by a newer posting; the job page itself forwards to the successor) are never served here.
  if (!job || job.source_type !== "internal" || isLinkOutPosting(job) || job.superseded_at || job.status !== "open" || job.removed_at || !job.organization_id || !job.apply_link || !job.apply_link_kind) {
    return back(unavailable);
  }

  const { data: org } = await admin.from("organizations").select("domain, verified, name").eq("id", job.organization_id).maybeSingle();
  const companyDomain = org?.verified ? (org.domain ?? "").trim().toLowerCase() || null : null;
  const verdict = checkApplyLink(job.apply_link, companyDomain, { companyName: org?.name });
  if (!verdict.ok) return back(unavailable);

  after(async () => {
    try {
      await admin.rpc("record_apply_link_click", { p_job_id: id });
    } catch {
      // Best-effort by design: a counter that is down must never be noticed by the seeker.
    }
  });
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: verdict.url } });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 204, headers: HEADERS });
}
