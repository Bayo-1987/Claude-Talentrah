import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { tailorResumeToJob } from "@/lib/tailoring/tailor";
import {
  checkTailoringAllowance,
  commitTailoringAllowance,
  InsufficientCreditsError,
} from "@/lib/tailoring/gate";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";
import { recommendCoursesForGapAnalysis } from "@/lib/courses/recommend";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  /*
   * Frequency limit, separate from and prior to the credit gate.
   *
   * The credit gate constrains SPEND, not BURST — and it is not the first
   * thing this route does either. A user with credits, or one still inside
   * the free trial before it flips, can fire concurrent requests as fast as
   * the network allows, and each one reaches a paid model call. Farah's chat
   * route has had a per-hour cap since it shipped; the two routes that
   * actually generate documents had none.
   *
   * Checked before parsing the body so a flood of malformed requests is
   * counted too.
   */
  const quota = await consumeRateLimit(user.id, "tailoring");
  if (!quota.allowed) return rateLimited(quota);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";
  const jobPostingId = typeof body.jobPostingId === "string" ? body.jobPostingId : null;
  const includeCoverLetter = !!body.includeCoverLetter;

  if (!jdText || jdText.length < 50) {
    return NextResponse.json(
      { error: "Paste the full job description — that looked too short." },
      { status: 400 },
    );
  }

  const { data: baseResumeRow, error: baseResumeError } = await supabase
    .from("resumes")
    .select("structured_content")
    .eq("user_id", user.id)
    .eq("is_base", true)
    .maybeSingle();

  if (baseResumeError) {
    return NextResponse.json(
      { error: "Couldn't load your resume — try again in a moment." },
      { status: 500 },
    );
  }

  if (!baseResumeRow) {
    return NextResponse.json(
      { error: "Upload or build a base resume before tailoring." },
      { status: 400 },
    );
  }

  const baseResume = (baseResumeRow.structured_content as StructuredResume | null) ?? EMPTY_RESUME;

  // Check affordability BEFORE calling Claude — a failed/unaffordable
  // request should never burn the free trial or spend credits, and an
  // unaffordable one should never trigger (and cost Talentrah for) an LLM
  // call in the first place.
  let tailoringAllowance;
  try {
    tailoringAllowance = await checkTailoringAllowance(user.id, "tailoring");
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: err.capMessage ?? "Not enough credits for a tailoring run.", needsCredits: true },
        { status: 402 },
      );
    }
    throw err;
  }

  let coverLetterAllowance: Awaited<ReturnType<typeof checkTailoringAllowance>> | null = null;
  if (includeCoverLetter) {
    try {
      coverLetterAllowance = await checkTailoringAllowance(user.id, "cover_letter");
    } catch (err) {
      if (!(err instanceof InsufficientCreditsError)) throw err;
      // Proceed with the tailoring (still affordable) but skip the letter.
    }
  }

  let result;
  try {
    result = await tailorResumeToJob(baseResume, jdText, coverLetterAllowance !== null);
  } catch (err) {
    // Never surface a raw provider/parse error to the client — see the
    // same fix in src/app/api/farah/chat/route.ts for why. Log which
    // provider/kind of failure server-side (src/lib/llm/errors.ts) rather
    // than a generic "Gemini failed" — the LLM call now goes through
    // whichever provider LLM_PROVIDER selects, not always Gemini.
    console.error("Tailoring: LLM call failed", err);
    return NextResponse.json(
      { error: "Farah couldn't tailor this one — try again in a moment." },
      { status: 502 },
    );
  }

  // Only now — after the LLM call actually succeeded — commit the spend.
  await commitTailoringAllowance(user.id, "tailoring", tailoringAllowance);
  if (coverLetterAllowance) {
    await commitTailoringAllowance(user.id, "cover_letter", coverLetterAllowance);
  }

  const { data: tailoredResumeRow, error: resumeError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      is_base: false,
      title: result.structuredJd.title ? `Tailored — ${result.structuredJd.title}` : "Tailored resume",
      source: "tailored",
      tailored_for_job_id: jobPostingId,
      structured_content: JSON.parse(JSON.stringify(result.tailoredResume)),
    })
    .select("id")
    .single();

  if (resumeError || !tailoredResumeRow) {
    return NextResponse.json({ error: "Couldn't save the tailored resume." }, { status: 500 });
  }

  let coverLetterResumeId: string | null = null;
  if (result.coverLetter) {
    const { data: letterRow } = await supabase
      .from("resumes")
      .insert({
        user_id: user.id,
        is_base: false,
        title: result.structuredJd.title ? `Cover letter — ${result.structuredJd.title}` : "Cover letter",
        source: "tailored",
        tailored_for_job_id: jobPostingId,
        structured_content: JSON.parse(
          JSON.stringify({ ...EMPTY_RESUME, summary: result.coverLetter }),
        ),
      })
      .select("id")
      .single();
    coverLetterResumeId = letterRow?.id ?? null;
  }

  const totalCreditsSpent = tailoringAllowance.creditsSpent + (coverLetterAllowance?.creditsSpent ?? 0);
  const isFreeTrial = tailoringAllowance.isFreeTrial || (coverLetterAllowance?.isFreeTrial ?? false);
  // Both legs are covered by the SAME pass-and-cap check within one request,
  // so they can only ever agree — but this reads as "was this run free
  // because of the Pass" rather than assuming that from creditsSpent === 0,
  // which is also true (and means something different) for the free trial.
  const isPassCovered = tailoringAllowance.isPassCovered || (coverLetterAllowance?.isPassCovered ?? false);

  // Service role (migration 0031): this row is the server's record of what it
  // just did and charged for. `authenticated` no longer holds INSERT on the
  // table, so a user cannot fabricate their own tailoring history.
  await createServiceRoleClient().from("job_tailoring_requests").insert({
    user_id: user.id,
    source_job_posting_id: jobPostingId,
    source_jd_text: jdText,
    gap_analysis: JSON.parse(JSON.stringify(result.gapAnalysis)),
    tailored_resume_id: tailoredResumeRow.id,
    tailored_cover_letter_id: coverLetterResumeId,
    is_free_trial: isFreeTrial,
    credits_spent: totalCreditsSpent,
  });

  /*
   * Course recommendations for the gaps Farah just found.
   *
   * Computed here rather than in the browser for two reasons. The catalog is
   * server data the page has no other reason to hold, so shipping all of it to
   * every client to pick two rows would be paying bandwidth for something the
   * target market pays for by the megabyte. And the affiliate URLs stay out of
   * the page entirely until there is a result that actually cites them.
   *
   * Awaited AFTER the charge and after the tailoring row is written, so its
   * failure cannot cost a paid run — `recommendCoursesForGapAnalysis` does not
   * throw, and an empty list is a normal answer rather than an error state.
   */
  const courseRecommendations = await recommendCoursesForGapAnalysis(
    supabase,
    result.gapAnalysis,
  );

  return NextResponse.json({
    resumeId: tailoredResumeRow.id,
    coverLetterResumeId,
    result,
    isFreeTrial,
    isPassCovered,
    creditsSpent: totalCreditsSpent,
    courseRecommendations,
  });
}
