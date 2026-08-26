import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdminSecret, internalError } from "@/lib/api/admin-auth";

/**
 * §6.8's review gate for ad campaigns, operator side.
 *
 * Deliberately the same shape as /api/admin/moderate-scholarship rather than a
 * new one: an authenticated admin route with a GET that lists the queue and a
 * POST that decides one item. A polished review UI is not in scope; the GATE
 * is, and a gate with no way to operate it is a gate that gets bypassed.
 *
 * GET  — campaigns awaiting review. Service-role read, so it sees rows that
 *        `is_org_member` hides from every normal session.
 * POST — decide one: { id, approve, note? }.
 *
 * Fails closed on the shared admin guard (0037-era work): an unset secret
 * answers 401 rather than publishing the queue, which is the bug that guard
 * exists to prevent.
 *
 * WHY APPROVAL DOES NOT GO LIVE. `set_ad_campaign_review` lands an approved
 * campaign in `paused_by_employer`, not `active`. Approval says the ad is
 * acceptable; it says nothing about whether the employer's wallet can pay for
 * it. Going live is `resume_ad_campaign`, which charges — so there is exactly
 * one path from not-running to running and it always costs money. Two paths
 * would be two places to forget the charge.
 */

export async function GET(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select(
      "id, name, status, daily_rate_ngn, total_budget_ngn, submitted_at, " +
        "organizations(name, domain, verified), job_postings(title, location)",
    )
    .eq("status", "pending_review")
    .order("submitted_at", { ascending: true });

  if (error) return internalError("moderate-campaign:list", error);
  return NextResponse.json({ count: data?.length ?? 0, campaigns: data ?? [] });
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let body: { id?: string; approve?: boolean; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { id, approve, note } = body;
  if (!id || typeof approve !== "boolean") {
    return NextResponse.json(
      { error: "Requires { id, approve } and, for a rejection, { note }." },
      { status: 400 },
    );
  }
  if (!approve && !note?.trim()) {
    // A rejection with no reason is not a review — the employer has no way to
    // fix it, and the next reviewer has no way to know what was wrong.
    return NextResponse.json(
      { error: "A rejection needs a note explaining what to change." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("set_ad_campaign_review", {
    p_campaign_id: id,
    p_approve: approve,
    // Both are nullable in SQL; typegen renders a parameter without a
    // DEFAULT as non-optional and so over-narrows them.
    //
    // The null reviewer is deliberate, not a placeholder to fill in later.
    // This route authenticates with a SHARED SECRET, which proves "an
    // operator" and not "WHICH operator". The route therefore does not accept
    // a reviewer id in the body either: a caller-supplied one is a claim by
    // whoever holds the secret, and recording it would make `reviewed_by`
    // look like attribution while being self-asserted — worse than an honest
    // null, because a null is visibly missing and a wrong name is not.
    // Real per-reviewer attribution needs admin sessions, which is a bigger
    // change than this route.
    p_reviewer_id: null as unknown as string,
    p_note: (note ?? null) as unknown as string,
  });

  if (error) return internalError("moderate-campaign:decide", error);
  if (!data) {
    return NextResponse.json(
      { error: "That campaign isn't awaiting review." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    id,
    status: data,
    // Said explicitly in the response because it is the part an operator gets
    // wrong: approving does not start the campaign or spend anything.
    note: approve
      ? "Approved. The campaign is paused until the employer resumes it, which is when it first charges."
      : "Rejected.",
  });
}
