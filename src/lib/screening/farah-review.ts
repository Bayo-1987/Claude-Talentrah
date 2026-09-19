import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateWithFailover } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { FARAH_SCREENING_REVIEW_NGN } from "@/lib/billing/catalog";
import { stripInlineMarkdown } from "@/lib/farah/render-markdown";

/**
 * send-345 Part B — Farah's advisory review of one free_text screening
 * answer, on a `screening_mode = 'farah'` question (0176). Called from
 * `applyWithScreeningAction` (applications/actions.ts) via `after()`, so an
 * LLM round trip never adds latency to the candidate's apply response and a
 * failure here never blocks or delays it — see that call site's own comment.
 *
 * WHAT THIS NEVER DOES: write `passed` (submit_screening_answers' job alone
 * — this only ever writes the farah_* columns 0176 added); surface anything
 * to the candidate, success or failure; retry automatically (v1 has none).
 *
 * service-role throughout, deliberately not the candidate's own RLS-scoped
 * session — this debits and annotates the EMPLOYER's ad wallet.
 */

const FARAH_SCREENING_SCHEMA = {
  type: "object",
  properties: {
    tier: {
      type: "string",
      enum: ["strong", "adequate", "weak"],
      description:
        "Farah's own qualitative read of the answer — never a numeric score, and never the match-score system's Excellent/Good/Fair words.",
    },
    summary: {
      type: "string",
      description:
        "Two or three sentences, addressed to the EMPLOYER reading this candidate's answer. Under 500 characters.",
    },
  },
  required: ["tier", "summary"],
} as const;

interface FarahReviewVerdict {
  tier: "strong" | "adequate" | "weak";
  summary: string;
}

async function gradeAnswer(questionText: string, answerText: string): Promise<FarahReviewVerdict> {
  // send-373 — answerText can now carry bold/italic markdown syntax
  // (screening-gate-apply.tsx's own MinimalRichEditor). Farah should judge
  // the candidate's actual words, not this app's own authoring syntax mixed
  // into them — a `**` a candidate never typed as emphasis-for-Farah's-
  // benefit shouldn't read as if it were part of "what's actually written."
  const plainAnswerText = stripInlineMarkdown(answerText);
  const raw = await generateWithFailover((provider) =>
    provider.generateText({
      systemPrompt: FARAH_SYSTEM_PROMPT,
      turns: [
        {
          role: "user",
          content: `An employer asked a job applicant a screening question and wants your read on the written answer — is it a strong, adequate, or weak response? Judge only what's actually written: specificity, relevance to the question, and whether it reads as a genuine, considered answer rather than a placeholder or non-answer. Do not judge grammar or spelling harshly, and do not penalize a short answer that is genuinely on point.

QUESTION: ${questionText}

ANSWER: ${plainAnswerText}`,
        },
      ],
      maxOutputTokens: 512,
      jsonSchema: FARAH_SCREENING_SCHEMA as unknown as Record<string, unknown>,
    }),
  );

  const parsed = JSON.parse(raw) as { tier?: unknown; summary?: unknown };
  if (parsed.tier !== "strong" && parsed.tier !== "adequate" && parsed.tier !== "weak") {
    throw new Error(`unparsable tier: ${JSON.stringify(parsed.tier)}`);
  }
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new Error("unparsable or empty summary");
  }
  return { tier: parsed.tier, summary: parsed.summary.trim().slice(0, 500) };
}

export async function runFarahScreeningReview(params: {
  applicationId: string;
  questionId: string;
  questionText: string;
  answerText: string;
}): Promise<void> {
  const { applicationId, questionId, questionText, answerText } = params;
  const supabase = createServiceRoleClient();

  let verdict: FarahReviewVerdict;
  try {
    verdict = await gradeAnswer(questionText, answerText);
  } catch (err) {
    // Never surfaced to the candidate, never blocks the application — the
    // application was already recorded by the time this runs at all (see
    // this file's own header). Just a plain UPDATE: no wallet interaction,
    // since nothing was ever charged for a review that never completed.
    console.error(
      `[farah-screening-review] LLM call failed for application ${applicationId} / question ${questionId}:`,
      err,
    );
    const { error } = await supabase
      .from("application_screening_answers")
      .update({ farah_review_status: "skipped_error" })
      .eq("application_id", applicationId)
      .eq("question_id", questionId);
    if (error) {
      console.error(`[farah-screening-review] could not record skipped_error:`, error.message);
    }
    return;
  }

  const { error } = await supabase.rpc("record_farah_screening_review", {
    p_application_id: applicationId,
    p_question_id: questionId,
    p_tier: verdict.tier,
    p_summary: verdict.summary,
    p_amount_ngn: FARAH_SCREENING_REVIEW_NGN,
  });
  if (error) {
    console.error(
      `[farah-screening-review] record_farah_screening_review failed for application ${applicationId} / question ${questionId}:`,
      error.message,
    );
  }
}
