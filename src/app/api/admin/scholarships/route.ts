import { NextResponse } from "next/server";
import { upsertScholarships } from "@/lib/scholarships/ingest";
import { manualScholarshipSchema, toNormalizedScholarship } from "@/lib/scholarships/schemas";
import { requireAdminSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Post one scholarship by hand.
 *
 * M10 ships a hand-curated catalog on purpose — §10 item 19's legal review has
 * to happen before any scraped source can be relied on commercially — and
 * until now the only way to add a listing was to edit sources.config.ts and
 * deploy. This is the same curation, without the deploy.
 *
 * Gated on the shared admin secret like every other route under /api/admin,
 * via requireAdminSecret, which fails closed when no secret is configured.
 * Nothing here invents its own check; the last time these routes each rolled
 * their own, four of them were live and unauthenticated (see admin-auth.ts).
 *
 * It writes through `upsertScholarships`, the same function the seed ingestion
 * uses, so a manual listing is subject to the same fingerprint dedup and the
 * same refusal to set `moderation_status`. A posted listing lands `pending`
 * and reaches the public catalog only when a human calls
 * /api/admin/moderate-scholarship. There is no field on this route that can
 * change that — see the note on manualScholarshipSchema.
 */

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = manualScholarshipSchema.safeParse(body);
  if (!parsed.success) {
    /*
     * Field errors are echoed here, unlike the internal-error path, and that
     * is a deliberate difference rather than an inconsistency: these describe
     * the caller's own payload back to an authenticated operator, not our
     * schema to a stranger. Without them the form has nothing to show but
     * "invalid".
     */
    return NextResponse.json(
      { error: "Check the submitted fields.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const listing = toNormalizedScholarship(parsed.data);

  let result;
  try {
    result = await upsertScholarships([listing]);
  } catch (err) {
    return internalError("admin-scholarships:create", err);
  }

  if (result.error) {
    return internalError("admin-scholarships:create", new Error(result.error));
  }

  console.log(
    `[admin-scholarships] manual listing upserted: provider=${listing.provider} program=${listing.programName} cycle=${listing.cycleYear ?? "none"}`,
  );

  /*
   * `published: false` is the promise this route can always keep, whatever it
   * hit. `returnedToReview` is the one outcome the caller could not otherwise
   * infer and would want to know about: the post matched a listing that was
   * already live, its content differed, and it is now back in the queue —
   * meaning something a seeker could see a moment ago is no longer visible.
   */
  return NextResponse.json(
    { ok: true, published: false, returnedToReview: result.returnedToReview.length > 0 },
    { status: 201 },
  );
}
