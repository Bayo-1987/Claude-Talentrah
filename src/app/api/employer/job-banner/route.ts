import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";
import {
  BANNER_BUCKET,
  MAX_BANNER_BYTES,
  bannerObjectPath,
  readImageDimensions,
  validateBanner,
} from "@/lib/employer/banner";

/**
 * Upload (or replace) one job posting's banner.
 *
 * ── WHO IS ALLOWED, AND WHAT ACTUALLY ENFORCES IT ─────────────────────────
 *
 * Three separate things have to agree, and none of them is trusted alone:
 *
 *   1. This handler re-reads the posting through the CALLER'S OWN client. If
 *      they cannot see it, they get the same 404 a stranger gets — the RLS
 *      policy decides, exactly as it does for editing a posting.
 *   2. The upload itself also goes through the caller's client, so 0115's
 *      storage policy (`is_org_member` on the path's first folder) is what
 *      authorises the write. A regression in that policy fails here loudly
 *      rather than being papered over by a service-role upload.
 *   3. Only the final `banner_path` write uses the service role, because that
 *      column is deliberately not client-writable.
 *
 * The path is COMPOSED HERE from the posting's own organisation, never taken
 * from the request. That is what makes "upload into someone else's folder"
 * unexpressible rather than merely refused.
 *
 * ── VALIDATION ORDER IS DELIBERATE ────────────────────────────────────────
 *
 * Size before bytes, bytes before dimensions, dimensions before any network
 * call. Each step is cheaper than the next and each one that fails means the
 * later ones would have been wasted work on a file we are going to reject.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const quota = await consumeRateLimit(user.id, "jobBannerUpload");
  if (!quota.allowed) return rateLimited(quota);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    // `request.formData()` REJECTS on a malformed or truncated body rather
    // than resolving empty — the same guard the resume upload route learned.
    return NextResponse.json({ error: "That upload didn't arrive intact. Try again." }, { status: 400 });
  }

  const jobId = formData.get("jobId");
  const file = formData.get("file");
  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json({ error: "Which posting is this for?" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image uploaded." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file appears to be empty." }, { status: 400 });
  }
  if (file.size > MAX_BANNER_BYTES) {
    return NextResponse.json(
      { error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.` },
      { status: 400 },
    );
  }

  /*
   * The posting, through the caller's own client. This answers "may you touch
   * this?" and "which organisation owns it?" in one read, and both answers
   * come from RLS rather than from anything the request said.
   */
  const { data: job, error: jobError } = await supabase
    .from("job_postings")
    .select("id, organization_id, source_type")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    console.error("[job-banner] could not read the posting:", jobError.message);
    return NextResponse.json({ error: "Couldn't load that posting." }, { status: 500 });
  }
  // Same answer for "no such posting" and "not yours": distinguishing them
  // would tell a stranger which ids exist.
  if (!job || !job.organization_id || job.source_type !== "internal") {
    return NextResponse.json({ error: "That posting isn't yours to edit." }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = readImageDimensions(bytes);
  if (!dimensions) {
    return NextResponse.json(
      { error: "That file isn't a readable PNG, JPEG or WebP image." },
      { status: 400 },
    );
  }

  const verdict = validateBanner({
    bytes,
    byteLength: file.size,
    width: dimensions.width,
    height: dimensions.height,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const path = bannerObjectPath(job.organization_id, job.id, verdict.type);

  const { error: uploadError } = await supabase.storage
    .from(BANNER_BUCKET)
    .upload(path, bytes, { contentType: verdict.type, upsert: true });

  if (uploadError) {
    // Checked, and surfaced rather than swallowed. A refused upload is the
    // shape a storage-policy regression takes, and a silent one here would
    // leave the employer looking at a form that appeared to work.
    console.error("[job-banner] upload refused:", uploadError.message);
    return NextResponse.json({ error: "Couldn't store that image. Try again." }, { status: 500 });
  }

  /*
   * The column write is the one elevated step. `banner_path` is not in the
   * client-writable grant list, deliberately — see 0115 — so this is the only
   * path that sets it, after everything above has already passed.
   *
   * `.eq("organization_id", ...)` is belt-and-braces on top of the read that
   * already proved ownership: both must agree, neither is trusted alone, the
   * same way updateJobAction guards its own write.
   */
  const admin = createServiceRoleClient();
  const { error: writeError } = await admin
    .from("job_postings")
    .update({ banner_path: path })
    .eq("id", job.id)
    .eq("organization_id", job.organization_id);

  if (writeError) {
    console.error("[job-banner] stored the image but could not record it:", writeError.message);
    return NextResponse.json(
      { error: "The image uploaded but couldn't be attached to the posting." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, width: verdict.width, height: verdict.height });
}
