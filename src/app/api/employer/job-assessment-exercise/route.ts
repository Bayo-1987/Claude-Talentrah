import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";
import {
  ASSESSMENT_EXERCISE_BUCKET,
  MAX_ASSESSMENT_DOCUMENT_BYTES,
  MAX_ASSESSMENT_FILES,
  exerciseObjectPath,
  validateAssessmentDocument,
} from "@/lib/employer/assessment-document";
import { clearAssessmentExerciseLink } from "@/lib/employer/job-posting-assessment";

/**
 * Upload (POST) or remove (DELETE) one of a job posting's assessment
 * EXERCISE files (send-364, 0178 — widened from a single
 * `exercise_file_path` column to a `job_posting_assessment_files` table).
 * Modeled directly on /api/employer/job-banner/route.ts, same three things
 * agreeing, none trusted alone:
 *
 *   1. This handler re-reads the posting through the CALLER'S OWN client.
 *   2. The storage upload/delete itself also goes through the caller's
 *      client, so 0177's storage policy (`is_org_member` on the path's
 *      first folder — unchanged by 0178, see that migration's own header)
 *      is what authorises it.
 *   3. Every DATABASE write (the file row, and clearing any existing link)
 *      ALSO goes through the caller's own client now — unlike the
 *      single-file version, which needed the service role to combine two
 *      column writes on ONE row atomically. There is no such row-sharing
 *      here: the file row is its own row in its own table, so 0178's own
 *      "org members can manage their own assessment's files" policy (and
 *      0177's identical policy on the parent row, for clearing the link)
 *      is enough on its own — no service role needed anywhere in this
 *      route any more.
 *
 * The path is COMPOSED HERE from the posting's own organisation, never
 * taken from the request.
 *
 * This route is EDIT-PAGE-OR-JUST-AFTER-CREATE: see
 * assessment-exercise-upload.tsx (Edit) and
 * post-success-assessment-files-note.tsx (the create flow's own deferred
 * upload, once postJobAction's redirect has produced a real jobId) — both
 * call this same route, unlike the single-file version, which was
 * genuinely Edit-only because staging a whole file client-side across
 * that redirect wasn't solved yet.
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

  /*
   * The assessment row itself (title/instructions/required) is written by
   * the job posting form BEFORE this route can ever be called
   * meaningfully — title/instructions are NOT NULL and this route has
   * neither. Checked explicitly (a lookup returning nothing) rather than
   * discovered later as a foreign-key violation on the file insert, so the
   * error message can say something useful.
   */
  const { data: assessment, error: assessmentError } = await supabase
    .from("job_posting_assessments")
    .select("id")
    .eq("job_posting_id", job.id)
    .eq("organization_id", job.organization_id)
    .maybeSingle();

  if (assessmentError) {
    console.error("[job-assessment-exercise] could not read the assessment:", assessmentError.message);
    return NextResponse.json({ error: "Couldn't load that posting's assessment." }, { status: 500 });
  }
  if (!assessment) {
    return NextResponse.json(
      { error: "Save the assessment's title and instructions first, then upload a file." },
      { status: 400 },
    );
  }

  /*
   * A nicer error message than the DB trigger's own — checked BEFORE the
   * (comparatively expensive) storage upload, same "cheap checks before
   * expensive ones" order banner.ts's own validation already follows. This
   * is NOT the real enforcement: 0178's enforce_max_assessment_files
   * trigger is, since a plain count-then-insert from here has a race
   * window between two concurrent uploads that only a database-side
   * atomic check closes (see that migration's own header). A request that
   * slips past this pre-check under a genuine race still gets refused by
   * the trigger below, just with a less specific error.
   */
  const { count: existingCount, error: countError } = await supabase
    .from("job_posting_assessment_files")
    .select("id", { count: "exact", head: true })
    .eq("job_posting_assessment_id", assessment.id);
  if (countError) {
    console.error("[job-assessment-exercise] could not count existing files:", countError.message);
    return NextResponse.json({ error: "Couldn't check the current files." }, { status: 500 });
  }
  if ((existingCount ?? 0) >= MAX_ASSESSMENT_FILES) {
    return NextResponse.json(
      { error: `An assessment can have at most ${MAX_ASSESSMENT_FILES} files. Remove one before adding another.` },
      { status: 400 },
    );
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

  // Generated here, before the row exists — see exerciseObjectPath's own
  // header on why the path needs this ahead of the DB insert.
  const fileId = randomUUID();
  const path = exerciseObjectPath(job.organization_id, job.id, fileId, verdict.type);

  const { error: uploadError } = await supabase.storage
    .from(ASSESSMENT_EXERCISE_BUCKET)
    .upload(path, bytes, { contentType: verdict.type, upsert: false });

  if (uploadError) {
    console.error("[job-assessment-exercise] upload refused:", uploadError.message);
    return NextResponse.json({ error: "Couldn't store that file. Try again." }, { status: 500 });
  }

  // Uploading a file is an alternative to a link, not an addition — the
  // same direction reconcileJobPostingAssessment's own file-clears-link
  // case takes, just the other way round. Unconditional: idempotent no-op
  // when there was no link to clear.
  await clearAssessmentExerciseLink(supabase, assessment.id);

  const { error: insertError } = await supabase.from("job_posting_assessment_files").insert({
    id: fileId,
    job_posting_assessment_id: assessment.id,
    organization_id: job.organization_id,
    file_path: path,
    original_filename: file.name,
    byte_size: file.size,
  });

  if (insertError) {
    // The trigger's own cap rejection lands here too (a genuine race past
    // the pre-check above). Either way, the object is already in storage
    // with no DB row pointing at it — removed so it doesn't linger as an
    // orphan; best-effort, since reporting the ORIGINAL error to the
    // employer matters more than a cleanup failure.
    await supabase.storage.from(ASSESSMENT_EXERCISE_BUCKET).remove([path]).catch(() => null);
    console.error("[job-assessment-exercise] stored the file but could not record it:", insertError.message);
    const message = insertError.message.includes("at most")
      ? insertError.message
      : "The file uploaded but couldn't be attached to the assessment.";
    return NextResponse.json({ error: message }, { status: insertError.message.includes("at most") ? 400 : 500 });
  }

  return NextResponse.json({
    ok: true,
    file: { id: fileId, path, originalFilename: file.name, byteSize: file.size },
  });
}

/**
 * Removes one previously-uploaded exercise file. Same ownership rule as
 * POST above: re-reads the posting through the caller's own client first,
 * then confirms the file row actually belongs to THIS posting's assessment
 * before touching storage or the row — a fileId alone is not enough to
 * authorise a delete, the same "posting id and file both have to agree"
 * shape the response-side upload route already takes for its own ownership
 * check.
 *
 * Closes the "can't remove just the uploaded file without clearing the
 * whole assessment" gap flagged as a known-but-deferred issue in send-363's
 * own report — this is the same UX hole finally getting closed as a side
 * effect of doing multi-file properly.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const quota = await consumeRateLimit(user.id, "jobAssessmentExerciseDelete");
  if (!quota.allowed) return rateLimited(quota);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request didn't arrive intact." }, { status: 400 });
  }

  const jobId = (body as { jobId?: unknown } | null)?.jobId;
  const fileId = (body as { fileId?: unknown } | null)?.fileId;
  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json({ error: "Which posting is this for?" }, { status: 400 });
  }
  if (typeof fileId !== "string" || !fileId) {
    return NextResponse.json({ error: "Which file?" }, { status: 400 });
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

  const { data: file, error: fileError } = await supabase
    .from("job_posting_assessment_files")
    .select("id, file_path, job_posting_assessment_id, job_posting_assessments!inner(job_posting_id)")
    .eq("id", fileId)
    .eq("organization_id", job.organization_id)
    .maybeSingle();

  if (fileError) {
    console.error("[job-assessment-exercise] could not read the file row:", fileError.message);
    return NextResponse.json({ error: "Couldn't load that file." }, { status: 500 });
  }
  if (!file || file.job_posting_assessments.job_posting_id !== job.id) {
    return NextResponse.json({ error: "That file isn't attached to this posting." }, { status: 404 });
  }

  const { error: deleteRowError } = await supabase
    .from("job_posting_assessment_files")
    .delete()
    .eq("id", file.id);
  if (deleteRowError) {
    console.error("[job-assessment-exercise] could not remove the file row:", deleteRowError.message);
    return NextResponse.json({ error: "Couldn't remove that file. Try again." }, { status: 500 });
  }

  // Storage cleanup after the DB row is gone, and best-effort: the row is
  // the thing anything actually resolves a URL from, so a lingering
  // storage object with no row pointing at it is inert either way. Note
  // for anyone re-verifying this against a real public URL rather than the
  // object row directly: Supabase uploads this bucket's objects with
  // `cacheControl: max-age=3600` — a public CDN can keep serving a just-
  // deleted object's bytes for up to that long, which is expected CDN
  // behavior, not evidence this removal failed. Confirmed empirically
  // while building this: the remove() call below returns the removed
  // object's own metadata with no error, and the row is genuinely gone
  // from storage.objects, even while a `curl` of the public URL still
  // briefly 200s.
  await supabase.storage.from(ASSESSMENT_EXERCISE_BUCKET).remove([file.file_path]).catch(() => null);

  return NextResponse.json({ ok: true });
}
