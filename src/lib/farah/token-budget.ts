/**
 * Farah chat's request-size budget.
 *
 * WHY THIS FILE EXISTS. On 2026-09-08 production's Farah panel was returning
 * 502s in a loop:
 *
 *   [groq/unknown] 413 Request too large for model `openai/gpt-oss-120b`
 *   ... tokens per minute (TPM): Limit 8000, Requested 8563
 *
 * Groq's on-demand tier caps this model at 8,000 tokens per minute and counts
 * the RESERVED OUTPUT against that ceiling as well as the prompt — so a single
 * chat turn was asking for ~8,563 and being refused outright. It failed
 * inconsistently (only large-enough conversations tripped it) and "try again"
 * could never help, because the retry replays the same oversized history.
 *
 * These numbers live here, rather than inline in the route and the client,
 * for one reason: the guard in token-budget.test.ts has to measure THE REAL
 * CONSTANTS. A test that re-declares its own copies passes forever while the
 * route drifts back over the limit.
 *
 * NOT a real tokenizer. chars/4 is the standard rough approximation and is
 * deliberate — the alternative is a tokenizer dependency shipped to production
 * to defend a threshold that already carries >1,000 tokens of slack. If the
 * ceiling is ever tightened to where the approximation's error matters, that
 * is the point to reach for a real one.
 */

import type { StructuredResume } from "@/lib/resume/types";
import type { MatchExplanation } from "@/lib/matching/score";
import { fitSummary, gapSkills } from "@/lib/matching/vet-summary";

/** Groq's per-minute cap for `openai/gpt-oss-120b` on the tier production uses. */
export const PROVIDER_TPM_LIMIT = 8000;

/**
 * What a worst-case single turn is allowed to estimate at. The gap to
 * PROVIDER_TPM_LIMIT is intentional headroom, not slack to be spent later:
 * chars/4 under-counts some inputs, and the limit is per MINUTE, so two quick
 * turns share it.
 */
export const REQUEST_TOKEN_CEILING = 7000;

/**
 * Prior messages replayed on each turn. Was 12. Halved because a stored Farah
 * reply can itself be a full output budget's worth of tokens, so history was
 * the single largest and least-bounded contributor.
 */
export const HISTORY_TURNS = 6;

/** Longest user message accepted. Unchanged — it was never the problem. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Hard ceiling on the resume-derived grounding string. Previously uncapped,
 * so a skills-heavy resume could exceed the budget on its own regardless of
 * how short the conversation was.
 */
export const MAX_EXTRA_CONTEXT_CHARS = 500;

/** Skills included in that grounding string before truncation. */
export const MAX_EXTRA_CONTEXT_SKILLS = 10;

/**
 * Hard ceiling on the job-seeded grounding string (send-100) — same
 * discipline as MAX_EXTRA_CONTEXT_CHARS, a sibling budget line rather than a
 * bigger shared one, so a job-seeded turn's total extra context is capped by
 * construction (resume + job, each independently bounded) instead of by a
 * single number two unrelated builders would have to coordinate on.
 */
export const MAX_JOB_CONTEXT_CHARS = 500;

/** Skills included in the job-context string (matched or missing) before truncation. */
export const MAX_JOB_CONTEXT_SKILLS = 10;

/**
 * Reserved output for CHAT specifically. Was 1536, shared with `askFarah`'s
 * one-shot uses (tailoring, gap analysis) that legitimately need a
 * document-length budget. Chat does not: a conversational reply is short, and
 * the reservation is charged against TPM whether or not it is used.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 1024;

/**
 * Longest a single REPLAYED history message may be. Added after the first
 * three fixes measured at 8,300 — still over the cap.
 *
 * The term the other three miss: a Farah reply written under the OLD 1536
 * budget is still sitting in `farah_messages`, and lowering the budget for
 * future replies does nothing about the ones already stored. Three of those
 * replayed is 4,608 tokens on its own, which no amount of trimming elsewhere
 * offsets. Capping turns (HISTORY_TURNS) reduces how MANY; this caps how BIG,
 * which is the dimension that was actually unbounded.
 *
 * Chosen over dropping HISTORY_TURNS further because it preserves the number
 * of exchanges Farah can see — continuity was the reason not to cut turns
 * harder — while removing the unbounded term. Truncation affects only what is
 * REPLAYED to the model; the stored message and what the user sees in the
 * panel are untouched.
 */
export const MAX_HISTORY_MESSAGE_CHARS = 1500;

/** The standard rough approximation. See the header for why not a tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface WorstCaseInputs {
  /** Farah's system prompt, which is sent on every single request. */
  systemPromptChars: number;
  historyTurns: number;
  maxMessageChars: number;
  maxExtraContextChars: number;
  /** Reserved output tokens — counted against the provider's TPM cap. */
  maxOutputTokens: number;
  /**
   * The largest a STORED assistant reply can be, i.e. whatever output budget
   * was in force when it was generated. Distinct from maxOutputTokens because
   * history written under an older, larger budget is still replayed today.
   */
  storedReplyMaxTokens: number;
  /**
   * Per-message truncation applied when replaying history, if any. Undefined
   * models the pre-fix behaviour, where nothing bounded a stored message.
   */
  historyMessageMaxChars?: number;
}

/**
 * The largest single request the route can construct under a given config.
 *
 * History alternates user/assistant; the assistant side is far larger, so the
 * worst case assigns it the extra message when historyTurns is odd.
 */
export function estimateWorstCaseRequestTokens(i: WorstCaseInputs): number {
  const assistantMessages = Math.ceil(i.historyTurns / 2);
  const userMessages = Math.floor(i.historyTurns / 2);
  const perUserMessageTokens = Math.ceil(i.maxMessageChars / 4);

  // Truncation is a ceiling on top of whatever the message already was, so
  // each side takes the smaller of its natural maximum and the cap.
  const cap = i.historyMessageMaxChars ? Math.ceil(i.historyMessageMaxChars / 4) : undefined;
  const historyAssistantTokens = cap ? Math.min(i.storedReplyMaxTokens, cap) : i.storedReplyMaxTokens;
  const historyUserTokens = cap ? Math.min(perUserMessageTokens, cap) : perUserMessageTokens;

  return (
    Math.ceil(i.systemPromptChars / 4) +
    Math.ceil(i.maxExtraContextChars / 4) +
    assistantMessages * historyAssistantTokens +
    userMessages * historyUserTokens +
    perUserMessageTokens + // the turn the user just sent, never truncated
    i.maxOutputTokens
  );
}

/**
 * The resume-derived grounding string appended to Farah's system prompt.
 *
 * Lives here, next to the caps it obeys, so the budget test exercises the
 * REAL builder rather than a copy of it — the copy is what silently drifts.
 */
export function buildResumeContext(resume: StructuredResume): string {
  return `Context on this user, from their resume (only reference what's actually here — don't invent detail beyond it):
Summary: ${resume.summary ?? "(none given)"}
Skills: ${resume.skills.slice(0, MAX_EXTRA_CONTEXT_SKILLS).join(", ") || "(none given)"}
Most recent role: ${resume.experience[0] ? `${resume.experience[0].title} at ${resume.experience[0].company}` : "(none given)"}`.slice(
    0,
    MAX_EXTRA_CONTEXT_CHARS,
  );
}

/**
 * The job-seeded grounding string appended alongside `buildResumeContext`'s
 * output when a chat message was sent through a job card's "Ask Farah"
 * starter (send-100).
 *
 * Deliberately reuses `fitSummary`/`gapSkills` (src/lib/matching/vet-summary.ts)
 * rather than re-deriving matched/missing skills text — those already read
 * `match_scores.explanation`, the same object the job card's own free Vet
 * answers are built from, and CLAUDE.md's match-tier rule (no prose that
 * restates Excellent/Good/Fair) is enforced there once rather than twice.
 */
export function buildJobContext(
  job: { title: string; companyName: string },
  explanation: MatchExplanation,
): string {
  const missing = gapSkills(explanation);
  const gapLine = missing
    ? `Skills this posting names that aren't on the user's resume yet: ${missing.slice(0, MAX_JOB_CONTEXT_SKILLS).join(", ")}.`
    : "No named skill gaps.";
  return `Context on the job the user is asking about (only reference what's actually here — don't invent detail beyond it):
Job: ${job.title} at ${job.companyName}
${fitSummary(explanation)}
${gapLine}`.slice(0, MAX_JOB_CONTEXT_CHARS);
}
