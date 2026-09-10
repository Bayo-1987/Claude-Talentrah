import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordAdEvent } from "@/lib/ads/promoted";

/**
 * Records a click on a promoted job card — the half of ad serving that
 * `recordPromotedImpressions` (a server render) cannot cover, because a click
 * happens in the browser after the page has already been sent (0128). This is
 * the "API route or Server Action" `PromotedClickTracker` calls via
 * `navigator.sendBeacon`, chosen over a client-side Supabase call for the same
 * reason impressions never went that route: `record_ad_event` is
 * service_role-only EXECUTE (0052), and an event log a client could write to
 * directly is an invoice a client could write.
 *
 * ── WHY THE (campaignId, jobPostingId) PAIR IS RE-VERIFIED HERE ───────────
 *
 * This route is the new trust boundary the impression path never had to
 * worry about: impressions are computed entirely server-side from
 * `promoted_jobs()`'s own response, but a click beacon's payload comes from
 * the browser, which is to say from whoever is running it. An authenticated
 * seeker's session is real, but the (campaignId, jobPostingId) values in the
 * request body are just numbers they read out of the page — a caller could
 * send ANY real campaign id it can see the "Sponsored" badge for, or, without
 * this check, a mismatched or long-dead one to pollute another organisation's
 * analytics. `findActiveCampaignForJobPosting` confirms the exact pair is
 * both real and currently `active` before anything gets written — the same
 * "an id existing is not the same as it being yours to act on" discipline
 * this codebase already applies everywhere else (e.g. job-banner's own
 * ownership re-check).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    // sendBeacon's payload arrives as plain text regardless of the Blob type
    // it was constructed with — parsed defensively, the same reason the
    // job-banner route wraps request.formData() in its own try/catch.
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const campaignId = (body as { campaignId?: unknown })?.campaignId;
  const jobPostingId = (body as { jobPostingId?: unknown })?.jobPostingId;
  if (typeof campaignId !== "string" || typeof jobPostingId !== "string" || !campaignId || !jobPostingId) {
    return NextResponse.json({ error: "Missing campaignId or jobPostingId." }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: campaign, error: campaignError } = await admin
    .from("ad_campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("job_posting_id", jobPostingId)
    .eq("status", "active")
    .maybeSingle();

  if (campaignError) {
    console.error("[ads/click] campaign lookup failed:", campaignError.message);
    return NextResponse.json({ error: "Couldn't record that." }, { status: 500 });
  }
  // Same non-committal answer whether the pair never existed, belongs to a
  // different posting, or the campaign simply isn't active any more — none of
  // those distinctions are this caller's to learn.
  if (!campaign) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  await recordAdEvent({
    campaignId,
    jobPostingId,
    userId: user.id,
    eventType: "click",
    surface: "job_feed_click",
  });

  return NextResponse.json({ ok: true });
}
