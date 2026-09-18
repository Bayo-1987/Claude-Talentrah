import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";
import {
  ASSESSMENT_SUBMISSION_BUCKET,
  MAX_ASSESSMENT_DOCUMENT_BYTES,
  submissionObjectPath,
  validateAssessmentDocument,
} from "@/lib/employer/assessment-document";

/**
 * Upload ONE of a candidate's assessment RESPONSE documents (send-346 v2,
 * 0177; widened to up to MAX_ASSESSMENT_FILES by send-365/0179), gated by
 * the candidate's OWN session — modeled on
 * /api/employer/job-banner/route.ts, adapted for a caller who does not yet
 * own the row the file will eventually be attached to.
 *
 * ── WHY THIS UPLOADS BEFORE THE APPLICATION EXISTS ──────────────────────
 *
 * Mirrors the two-step shape job-banner already established: a File cannot
 * be threaded through applyWithScreeningAction's plain-argument Server
 * Action call, so the candidate's browser uploads each file HERE first (if
 * any were picked at all) to get back a stored path, then the resulting
 * paths travel as a plain array into the same combined apply call that
 * already carries screening answers.
 *
 * There is no application row yet at upload time — the object path is
 * `<uploader's own user id>/<job_posting_id>/<file_id>.<ext>` specifically
 * because that is authorisable with nothing but the caller's own session
 * (0177's storage insert policy checks only that the first folder segment
 * is `auth.uid()`, unaffected by 0179's extra path segment — see that
 * migration's own header). This route's own job posting check is a
 * courtesy/abuse guard on top of that — refusing an upload for a posting
 * with no assessment at all — not the security boundary; the storage
 * policy is.
 *
 * ── THIS ROUTE DOES NOT ENFORCE THE 5-FILE CAP ──────────────────────────
 *
 * Unlike 0178's employer-side upload route (which counts existing rows
 * before each call, since a real row already exists to count), there is no
 * application_assessment_submissions row yet at upload time here — nothing
 * to count against. The cap is tracked client-side across the picker's own
 * in-progress selections (screening-gate-apply.tsx) for THIS one apply
 * attempt, and the real backstop is submit_assessment_response's own
 * `v_file_count > 5` check, which runs once, atomically, when the whole
 * batch of paths is finally submitted.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const quota = await consumeRateLimit(user.id, "jobAssessmentSubmissionUpload");
  if (!quota.allowed) return rateLimited(quota);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload didn't arrive intact. Try again." }, { status: 400 });
  }

  const jobPostingId = formData.get("jobPostingId");
  const file = formData.get("file");
  if (typeof jobPostingId !== "string" || !jobPostingId) {
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

  // Public read (job_posting_assessments has no RLS restriction on select),
  // so this is a plain existence check, not an ownership one — anyone can
  // read that this posting has an assessment, the same way anyone can read
  // the job description it sits next to.
  const { data: assessment, error: assessmentError } = await supabase
    .from("job_posting_assessments")
    .select("job_posting_id")
    .eq("job_posting_id", jobPostingId)
    .maybeSingle();

  if (assessmentError) {
    console.error("[assessment-response] could not read the assessment:", assessmentError.message);
    return NextResponse.json({ error: "Couldn't load that posting's assessment." }, { status: 500 });
  }
  if (!assessment) {
    return NextResponse.json({ error: "That posting has no assessment to respond to." }, { status: 404 });
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

  const path = submissionObjectPath(user.id, jobPostingId, randomUUID(), verdict.type);

  const { error: uploadError } = await supabase.storage
    .from(ASSESSMENT_SUBMISSION_BUCKET)
    .upload(path, bytes, { contentType: verdict.type, upsert: true });

  if (uploadError) {
    console.error("[assessment-response] upload refused:", uploadError.message);
    return NextResponse.json({ error: "Couldn't store that file. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path });
}
