import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";
import {
  ASSESSMENT_EXERCISE_BUCKET,
  MAX_ASSESSMENT_DOCUMENT_BYTES,
  exerciseObjectPath,
  validateAssessmentDocument,
} from "@/lib/employer/assessment-document";

/**
 * Upload (or replace) one job posting's assessment EXERCISE document
 * (send-346 v2, 0177) — modeled directly on
 * /api/employer/job-banner/route.ts, same three things agreeing, none
 * trusted alone:
 *
 *   1. This handler re-reads the posting through the CALLER'S OWN client.
 *   2. The upload itself also goes through the caller's client, so 0177's
 *      storage policy (`is_org_member` on the path's first folder) is what
 *      authorises the write.
 *   3. Only the final `exercise_file_path`/`exercise_link` write uses the
 *      service role — job_posting_assessments' own RLS already lets the
 *      caller's client write those columns directly (unlike banner_path,
 *      this isn't a withheld-grant column), but the service role is used
 *      here anyway so uploading a FILE always clears any previously-set
 *      LINK in the same statement — the exclusivity CHECK constraint would
 *      otherwise refuse a caller's own two-step (set file, then the
 *      trigger-free client write leaves the old link in place) update.
 *
 * The path is COMPOSED HERE from the posting's own organisation, never
 * taken from the request.
 *
 * This route is EDIT-PAGE ONLY, same original scoping job-banner had
 * before send-134's create-form staging: a brand-new posting has no
 * job_posting_id yet for the path to be built from. An employer attaching
 * an assessment to a NEW posting sets title/instructions/link/required at
 * creation time (plain form fields, no upload dependency) and adds the
 * actual file afterward from Edit — see job-posting-form.tsx's own comment
 * on this scoping decision.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const quota = await consumeRateLimit(user.id, "jobAssessmentExerciseUpload");
  if (!quota.allowed) return rateLimited(quota);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload didn't arrive intact. Try again." }, { status: 400 });
  }

  const jobId = formData.get("jobId");
  const file = formData.get("file");
  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json({ error: "Which posting is this for?" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file appears to be empty." }, { status: 400 });
  }
  if (file.size > MAX_ASSESSMENT_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.` },
      { status: 400 },
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("job_postings")
    .select("id, organization_id, source_type")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    console.error("[job-assessment-exercise] could not read the posting:", jobError.message);
    return NextResponse.json({ error: "Couldn't load that posting." }, { status: 500 });
  }
  if (!job || !job.organization_id || job.source_type !== "internal") {
    return NextResponse.json({ error: "That posting isn't yours to edit." }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = validateAssessmentDocument({
    bytes,
    byteLength: file.size,
    declaredContentType: file.type,
    filename: file.name,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const path = exerciseObjectPath(job.organization_id, job.id, verdict.type);

  const { error: uploadError } = await supabase.storage
    .from(ASSESSMENT_EXERCISE_BUCKET)
    .upload(path, bytes, { contentType: verdict.type, upsert: true });

  if (uploadError) {
    console.error("[job-assessment-exercise] upload refused:", uploadError.message);
    return NextResponse.json({ error: "Couldn't store that file. Try again." }, { status: 500 });
  }

  /*
   * The assessment row itself (title/instructions/required) is written by
   * the main job posting form BEFORE this route can ever be called
   * meaningfully — title/instructions are NOT NULL and this route has
   * neither. An UPDATE against a row that doesn't exist yet would silently
   * affect zero rows and report success, so this is checked explicitly
   * rather than trusted to the update's own (absent) error.
   */
  const admin = createServiceRoleClient();
  const { data: updated, error: writeError } = await admin
    .from("job_posting_assessments")
    .update({ exercise_file_path: path, exercise_link: null })
    .eq("job_posting_id", job.id)
    .eq("organization_id", job.organization_id)
    .select("id");

  if (writeError) {
    console.error("[job-assessment-exercise] stored the file but could not record it:", writeError.message);
    return NextResponse.json(
      { error: "The file uploaded but couldn't be attached to the assessment." },
      { status: 500 },
    );
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "Save the assessment's title and instructions first, then upload the file." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, path });
}
