"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadJobSnapshot } from "./job-snapshot";
import { logCountryDefaultEvent, type CountryState } from "@/lib/jobs/country-events";
import { findActiveCampaignForJobPosting, recordAdEvent } from "@/lib/ads/promoted";
import { computeAndStoreApplicationMatchScore } from "@/lib/matching/compute-and-store";
import { captureEvent } from "@/lib/analytics/posthog";
import { runFarahScreeningReview } from "@/lib/screening/farah-review";

async function getAuthedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/** Heart icon: saves a job, or un-saves it if it's only ever been saved (not applied further). */
export async function toggleSaveAction(jobId: string) {
  const { supabase, userId } = await getAuthedUserId();

  const { data: existing } = await supabase
    .from("applications")
    .select("id, stage")
    .eq("user_id", userId)
    .eq("job_posting_id", jobId)
    .maybeSingle();

  if (!existing) {
    // Snapshotted at creation (src/lib/applications/job-snapshot.ts) so this
    // row survives job_posting_id being deleted or nulled out later — see
    // that module's header for why.
    const snapshot = await loadJobSnapshot(supabase, jobId);
    const { error } = await supabase.from("applications").insert({
      user_id: userId,
      job_posting_id: jobId,
      stage: "saved",
      source: "manual",
      manual_job_snapshot: snapshot,
    });
    // A rejected insert resolves with `error`, it does not throw — checked,
    // per this repo's own standing rule (CLAUDE.md), because the alternative
    // is a Save click that reports success over a row that was never
    // written.
    if (error) throw new Error(`Couldn't save this job: ${error.message}`);
  } else if (existing.stage === "saved") {
    const { error } = await supabase.from("applications").delete().eq("id", existing.id);
    if (error) throw new Error(`Couldn't un-save this job: ${error.message}`);
  }

  revalidatePath("/jobs");
  /*
   * The detail route as well. `revalidatePath("/jobs")` refreshes that exact
   * path only, so before this a Save made from /jobs/<id> left the button on
   * that page still reading "Save" until a hard reload — the state changed and
   * the page it changed on did not.
   */
  revalidatePath("/jobs/[id]", "page");
}

/**
 * The actual apply write, factored out of `applyInAppAction` (send-327) so
 * `applyWithScreeningAction` (screening-actions.ts) can reuse the identical
 * logic and get the resulting application id back — `applyInAppAction`
 * itself never needed one, since every existing call site is a plain
 * `<form action={applyInAppAction.bind(...)}>` with nothing to do with a
 * return value. `applyInAppAction`'s own behavior is UNCHANGED: it calls
 * this and discards the id.
 */
async function performInAppApply(
  jobId: string,
  countryState: CountryState,
): Promise<{ applicationId: string }> {
  const { supabase, userId } = await getAuthedUserId();

  /*
   * Ad-funnel instrumentation (0128) — started here, NOT awaited here.
   *
   * This is the SAME campaign lookup both the click and (further below) the
   * apply event need, kicked off once as a plain promise so it runs
   * concurrently with everything else in this action instead of adding a
   * round trip to the button's own CTA latency (see the "Three-way parallel"
   * comment just below — apply already has a documented latency budget this
   * must not spend). Internal, non-promoted postings resolve to `null` almost
   * immediately and both `after()` blocks below become no-ops.
   */
  const activeCampaignId = findActiveCampaignForJobPosting(jobId);

  // The "Apply" control was activated, independent of whether the write below
  // succeeds — a click on Apply is a real ad interaction the moment the
  // button is pressed. Deferred via `after()`, same reasoning as
  // `logCountryDefaultEvent` further down: must never add latency to the
  // response, and a failure here must never fail the apply itself.
  after(async () => {
    try {
      const campaignId = await activeCampaignId;
      if (campaignId) {
        await recordAdEvent({
          campaignId,
          jobPostingId: jobId,
          userId,
          eventType: "click",
          surface: "job_feed_apply",
        });
      }
    } catch (err) {
      console.error("[ads] apply-click recording failed:", err);
    }
  });

  // Three-way parallel: none of these depend on either of the others — the
  // base-resume lookup used to run before this Promise.all for no reason,
  // making a click on Apply pay for three round-trips in sequence (1-then-2)
  // instead of the one this button's own CTA-latency fix (Button/IconButton
  // now show a real pending state via useFormStatus) still can't hide.
  const [{ data: baseResume, error: baseResumeError }, { data: existing }, snapshot] = await Promise.all([
    supabase.from("resumes").select("id").eq("user_id", userId).eq("is_base", true).maybeSingle(),
    supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle(),
    loadJobSnapshot(supabase, jobId),
  ]);

  // A missing resume is a legitimate state (resume_id just stays null below)
  // — a query error is not, and applying anyway would silently record the
  // wrong thing (QA audit bug #1). Fail loudly instead.
  if (baseResumeError) {
    throw new Error(`Couldn't look up your resume: ${baseResumeError.message}`);
  }

  const payload = {
    user_id: userId,
    job_posting_id: jobId,
    resume_id: baseResume?.id ?? null,
    stage: "applied" as const,
    source: "internal_apply" as const,
    applied_at: new Date().toISOString(),
    // See src/lib/applications/job-snapshot.ts — kept fresh on update too,
    // not just the first insert, so the snapshot never falls behind the
    // real posting while it still exists.
    manual_job_snapshot: snapshot,
  };

  // A rejected insert/update resolves with `error`, it does not throw —
  // checked, per this repo's own standing rule (CLAUDE.md), because the
  // alternative is an Apply click that reports success over a row that was
  // never written, which is exactly indistinguishable from a real apply
  // until someone goes looking at the tracker and finds nothing there.
  let applicationId: string;
  if (existing) {
    const { error } = await supabase.from("applications").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Couldn't record your application: ${error.message}`);
    applicationId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("applications")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(`Couldn't record your application: ${error.message}`);
    applicationId = inserted.id;
  }

  // channel distinguishes this from markAppliedExternallyAction's own
  // capture below — CLAUDE.md is explicit that Auto-Apply's external
  // matches are handed_off, never applied, and that distinction should
  // survive into analytics rather than being flattened into one event.
  captureEvent(userId, "application_submitted", { channel: "in_app" });

  // Deferred, not awaited: logCountryDefaultEvent's own header documents
  // that a logging failure inside it is swallowed (caught and console.error'd,
  // never thrown) and cannot fail the apply — exactly the kind of write
  // src/app/(app)/jobs/page.tsx's own after() block already defers off the
  // response path, for the same reason (the reader isn't waiting on it).
  after(async () => {
    await logCountryDefaultEvent({ userId, eventType: "apply", countryState, jobPostingId: jobId });
  });

  // The apply half of the ad funnel — only reached once the write above has
  // actually succeeded, unlike the click `after()` above it. Reuses the same
  // in-flight `activeCampaignId` lookup rather than querying again.
  after(async () => {
    try {
      const campaignId = await activeCampaignId;
      if (campaignId) {
        await recordAdEvent({
          campaignId,
          jobPostingId: jobId,
          userId,
          eventType: "apply",
          surface: "job_feed_apply",
        });
      }
    } catch (err) {
      console.error("[ads] apply-event recording failed:", err);
    }
  });

  // send-158: cache this applicant's match score against this job at the one
  // guaranteed moment a resume and a job posting exist together — see
  // computeAndStoreApplicationMatchScore's own header for why the feed's own
  // scoring can't be relied on to have already done this. Skipped entirely
  // when there's no base resume (payload.resume_id is already null in that
  // case) — nothing to score. Deferred and swallowed, same reasoning as
  // logCountryDefaultEvent just above: a scoring failure must never fail the
  // apply itself, and there is no response left to fail by the time this runs.
  if (payload.resume_id) {
    const resumeId = payload.resume_id;
    after(async () => {
      try {
        await computeAndStoreApplicationMatchScore(supabase, userId, jobId, resumeId);
      } catch (err) {
        console.error("[matching] could not score application:", err);
      }
    });
  }

  revalidatePath("/jobs");
  /*
   * The detail route as well. `revalidatePath("/jobs")` refreshes that exact
   * path only, so before this a Save made from /jobs/<id> left the button on
   * that page still reading "Save" until a hard reload — the state changed and
   * the page it changed on did not.
   */
  revalidatePath("/jobs/[id]", "page");
  revalidatePath("/tracker");

  return { applicationId };
}

/**
 * Internal jobs: applies in-app using the user's base resume.
 *
 * `countryState` is Stage 12 instrumentation only ("kept"/"cleared"/"none" —
 * see src/lib/jobs/country-events.ts) — bound in from whichever page rendered
 * the Apply button, the same way `jobId` already is. It never gates or
 * changes what this action does; a logging failure inside it is swallowed by
 * logCountryDefaultEvent itself and cannot fail the apply.
 */
export async function applyInAppAction(jobId: string, countryState: CountryState) {
  await performInAppApply(jobId, countryState);
}

export interface ScreeningAnswerInput {
  questionId: string;
  answerYesNo?: boolean;
  answerNumber?: number;
  answerText?: string;
}

/**
 * A candidate's file already uploaded via /api/jobs/assessment-response —
 * `originalFilename`/`byteSize` travel alongside the path because
 * submit_assessment_response (0179) inserts the
 * application_assessment_response_files row itself, in the same
 * transaction as the parent submission, and that row needs both columns;
 * the upload route's own response never carried them (the client already
 * has the picked File object, which is where these come from).
 */
export interface AssessmentResponseFileInput {
  path: string;
  originalFilename: string;
  byteSize: number;
}

/**
 * send-346 v2 — a candidate's response to a job posting's assessment,
 * submitted alongside screening answers in the same combined apply call.
 * `responseFiles`/`responseLink` are alternatives, not both — the
 * exclusivity check moved from a single-table CHECK constraint (0177) to
 * submit_assessment_response's own guard once send-365/0179 widened files
 * to a child table, same direction 0178 already took on the employer's
 * exercise side. Up to MAX_ASSESSMENT_FILES files per response (send-365 —
 * was exactly one before this).
 */
export interface AssessmentResponseInput {
  responseText?: string;
  responseFiles?: AssessmentResponseFileInput[];
  responseLink?: string;
}

function hasAssessmentResponse(input: AssessmentResponseInput | undefined): input is AssessmentResponseInput {
  return !!input && !!(input.responseText || (input.responseFiles && input.responseFiles.length > 0) || input.responseLink);
}

/**
 * send-327 — the apply flow for a job that has screening questions and/or
 * an assessment (send-346 v2 widened this beyond just screening — the name
 * stayed to avoid a second near-identical function, since both additions
 * share the exact same "apply first, attach more data second, report a
 * partial failure honestly" shape). Does the SAME write `applyInAppAction`
 * does (via the shared `performInAppApply` core, so nothing about the
 * application itself is a second implementation), then records the
 * candidate's screening answers via `submit_screening_answers` (0171) and/or
 * their assessment response via `submit_assessment_response` (0177) — two
 * independent SECURITY DEFINER calls, each atomic on its own.
 *
 * Neither ever blocks the application — see 0171's own header for the
 * block-vs-flag decision, which 0177's assessment table deliberately
 * mirrors (no grading exists to block on in the first place). If either
 * write fails for a real reason (not "nothing to submit"), the application
 * the candidate cares about has ALREADY been recorded by the time this
 * runs; the error is surfaced but nothing here rolls the apply back, the
 * same "a partial success is reported honestly, not hidden behind an
 * all-or-nothing illusion this isn't actually a transaction" stance
 * postJobAction's own screening-question write takes.
 */
export async function applyWithScreeningAction(
  jobId: string,
  countryState: CountryState,
  answers: ScreeningAnswerInput[],
  assessmentResponse?: AssessmentResponseInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { applicationId } = await performInAppApply(jobId, countryState);
  const { supabase } = await getAuthedUserId();

  if (answers.length > 0) {
    const { error } = await supabase.rpc("submit_screening_answers", {
      p_application_id: applicationId,
      p_answers: answers.map((a) => ({
        question_id: a.questionId,
        answer_yes_no: a.answerYesNo ?? null,
        answer_number: a.answerNumber ?? null,
        answer_text: a.answerText ?? null,
      })),
    });

    if (error) {
      return { ok: false, error: `Your application was recorded, but we couldn't save your answers: ${error.message}` };
    }

    /*
     * send-345 Part B — kick off Farah's review of any farah-mode free_text
     * question, deferred via `after()` for the SAME reason the ad-funnel
     * instrumentation above is: an LLM round trip must never add latency to
     * the candidate's apply response, and a failure here must never surface
     * to the candidate or block/delay the application, which has already been
     * recorded by this point.
     *
     * Reads the just-persisted, TRIMMED answer_text back from the database
     * rather than the raw candidate-submitted `answers` array — an
     * all-whitespace submission is stored as null (0175's own trim rule) and
     * correctly has nothing here to review; a genuinely answered farah-mode
     * question gets exactly the text the employer will actually see.
     */
    const { data: farahQuestions } = await supabase
      .from("job_posting_screening_questions")
      .select("id, question_text")
      .eq("job_posting_id", jobId)
      .eq("screening_mode", "farah");

    if (farahQuestions && farahQuestions.length > 0) {
      const { data: persistedAnswers } = await supabase
        .from("application_screening_answers")
        .select("question_id, answer_text")
        .eq("application_id", applicationId)
        .in(
          "question_id",
          farahQuestions.map((q) => q.id),
        )
        .not("answer_text", "is", null);

      for (const row of persistedAnswers ?? []) {
        const question = farahQuestions.find((q) => q.id === row.question_id);
        const answerText = row.answer_text;
        if (!question || !answerText) continue;
        after(() =>
          runFarahScreeningReview({
            applicationId,
            questionId: row.question_id,
            questionText: question.question_text,
            answerText,
          }),
        );
      }
    }
  }

  if (hasAssessmentResponse(assessmentResponse)) {
    const { error } = await supabase.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: assessmentResponse.responseText ?? null,
      // Keys must match what 0179's submit_assessment_response reads off
      // each jsonb array element (`path`, `originalFilename`, `byteSize`)
      // — rebuilt as plain object literals (not the named
      // AssessmentResponseFileInput type directly) so TypeScript accepts
      // this as Json, the same way submit_screening_answers' own p_answers
      // does just above.
      p_response_files: (assessmentResponse.responseFiles ?? []).map((f) => ({
        path: f.path,
        originalFilename: f.originalFilename,
        byteSize: f.byteSize,
      })),
      p_response_link: assessmentResponse.responseLink ?? null,
    });

    if (error) {
      return {
        ok: false,
        error: `Your application was recorded, but we couldn't save your assessment response: ${error.message}`,
      };
    }
  }

  return { ok: true };
}

/**
 * External jobs: the actual application happens on the source site; this
 * just logs it. `countryState` — see applyInAppAction's own header.
 */
export async function markAppliedExternallyAction(jobId: string, countryState: CountryState) {
  const { supabase, userId } = await getAuthedUserId();

  const [{ data: existing }, snapshot] = await Promise.all([
    supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle(),
    loadJobSnapshot(supabase, jobId),
  ]);

  const payload = {
    user_id: userId,
    job_posting_id: jobId,
    stage: "applied" as const,
    source: "manual" as const,
    applied_at: new Date().toISOString(),
    manual_job_snapshot: snapshot,
  };

  // See applyInAppAction's own comment above on why this is checked rather
  // than left to a silent no-op.
  if (existing) {
    const { error } = await supabase.from("applications").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Couldn't record this as applied: ${error.message}`);
  } else {
    const { error } = await supabase.from("applications").insert(payload);
    if (error) throw new Error(`Couldn't record this as applied: ${error.message}`);
  }

  // Same event as applyInAppAction, channel: "external" — see that
  // function's own comment.
  captureEvent(userId, "application_submitted", { channel: "external" });

  await logCountryDefaultEvent({ userId, eventType: "apply", countryState, jobPostingId: jobId });

  revalidatePath("/jobs");
  /*
   * The detail route as well. `revalidatePath("/jobs")` refreshes that exact
   * path only, so before this a Save made from /jobs/<id> left the button on
   * that page still reading "Save" until a hard reload — the state changed and
   * the page it changed on did not.
   */
  revalidatePath("/jobs/[id]", "page");
  revalidatePath("/tracker");
}
