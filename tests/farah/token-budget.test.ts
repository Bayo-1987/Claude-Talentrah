/**
 * Farah chat's request-size guard.
 *
 * THE BUG THIS EXISTS FOR. On 2026-09-08 production's Farah panel returned
 * 502s in a loop. Groq refused the request outright:
 *
 *   [groq/unknown] 413 Request too large for model `openai/gpt-oss-120b`
 *   ... tokens per minute (TPM): Limit 8000, Requested 8563
 *
 * Three things made it hard to see. It failed INCONSISTENTLY (only
 * large-enough conversations crossed 8,000). "Try again" could never work,
 * because the retry replays the same oversized history. And the reserved
 * OUTPUT budget counts against the cap too, so ~1,536 tokens were being spent
 * before a single word was generated.
 *
 * The discipline here is this repo's own: prove the guard catches the bug
 * BEFORE trusting that it passes. The first test below runs the real estimator
 * against the constants as they were at the moment of the incident and asserts
 * it would have failed. If that test ever starts passing, the guard has
 * stopped measuring anything.
 *
 * Note what these tests measure: the real exported constants and the real
 * `buildResumeContext`, imported from the module the route uses. They do not
 * re-declare the numbers — a test carrying its own copies passes forever while
 * production drifts back over the limit, which is the failure mode that let
 * this ship.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_OUTPUT_TOKENS,
  HISTORY_TURNS,
  MAX_EXTRA_CONTEXT_CHARS,
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_MESSAGE_LENGTH,
  PROVIDER_TPM_LIMIT,
  REQUEST_TOKEN_CEILING,
  buildResumeContext,
  estimateTokens,
  estimateWorstCaseRequestTokens,
} from "@/lib/farah/token-budget";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import type { StructuredResume } from "@/lib/resume/types";

const SYSTEM_PROMPT_CHARS = FARAH_SYSTEM_PROMPT.length;

/** The constants as they stood when production started 502-ing. */
const BEFORE_THE_FIX = {
  systemPromptChars: SYSTEM_PROMPT_CHARS,
  historyTurns: 12,
  maxMessageChars: 2000,
  // Uncapped: the old builder emitted the whole summary and every skill.
  maxExtraContextChars: 900,
  maxOutputTokens: 1536,
  storedReplyMaxTokens: 1536,
};

/** The constants as they are now — read from the module, never retyped. */
const AFTER_THE_FIX = {
  systemPromptChars: SYSTEM_PROMPT_CHARS,
  historyTurns: HISTORY_TURNS,
  maxMessageChars: MAX_MESSAGE_LENGTH,
  maxExtraContextChars: MAX_EXTRA_CONTEXT_CHARS,
  maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
  // Deliberately the OLD 1536, not the new 1024: replies written before this
  // fix are still sitting in farah_messages and still get replayed. Assuming
  // the new, smaller budget here would understate the real worst case for
  // every existing conversation.
  storedReplyMaxTokens: 1536,
  historyMessageMaxChars: MAX_HISTORY_MESSAGE_CHARS,
};

/** A skills-heavy resume — the shape that could blow the budget on its own. */
function skillsHeavyResume(): StructuredResume {
  return {
    summary: "Senior engineer. ".repeat(40),
    skills: Array.from({ length: 60 }, (_, i) => `Distributed Systems Skill ${i}`),
    experience: [{ title: "Staff Engineer", company: "Example Corp" }],
  } as unknown as StructuredResume;
}

describe("the guard catches the bug it was written for", () => {
  it("would have FAILED on the constants that were live during the incident", () => {
    const estimate = estimateWorstCaseRequestTokens(BEFORE_THE_FIX);

    // The whole point: over the provider's hard cap, so the request is refused
    // before generation. This is the assertion that proves the guard is not
    // vacuous.
    expect(estimate).toBeGreaterThan(PROVIDER_TPM_LIMIT);
    expect(estimate).toBeGreaterThan(REQUEST_TOKEN_CEILING);
  });

  it("reproduces the observed failure's order of magnitude (~8563 requested)", () => {
    // Not an exact match — chars/4 is an approximation and the real request
    // carried one specific conversation, not the theoretical maximum. What
    // matters is that the old shape lands in the same territory as the number
    // Groq actually reported, rather than somewhere unrelated.
    const estimate = estimateWorstCaseRequestTokens(BEFORE_THE_FIX);
    expect(estimate).toBeGreaterThan(8000);
    expect(estimate).toBeLessThan(20000);
  });
});

describe("the fix holds", () => {
  it("keeps a worst-case turn under the ceiling, with real headroom", () => {
    const estimate = estimateWorstCaseRequestTokens(AFTER_THE_FIX);

    expect(estimate).toBeLessThan(REQUEST_TOKEN_CEILING);
    expect(estimate).toBeLessThan(PROVIDER_TPM_LIMIT);

    // Not a hairline pass. If a future change eats this margin the test should
    // fail while there is still room to think, not at 7,999.
    expect(PROVIDER_TPM_LIMIT - estimate).toBeGreaterThan(1000);
  });

  it("caps the resume context no matter how the resume was written", () => {
    const context = buildResumeContext(skillsHeavyResume());

    expect(context.length).toBeLessThanOrEqual(MAX_EXTRA_CONTEXT_CHARS);
    // The instruction not to invent detail must survive truncation, or the
    // grounding string becomes raw data with no framing.
    expect(context).toContain("don't invent detail");
  });

  it("would have been over the cap with the same resume before the fix", () => {
    // The uncapped builder is gone, so this reconstructs what it produced:
    // every skill, whole summary.
    const resume = skillsHeavyResume();
    const uncapped =
      `Context on this user, from their resume (only reference what's actually here — don't invent detail beyond it):\n` +
      `Summary: ${resume.summary}\nSkills: ${resume.skills.join(", ")}\n` +
      `Most recent role: ${resume.experience[0].title} at ${resume.experience[0].company}`;

    expect(uncapped.length).toBeGreaterThan(MAX_EXTRA_CONTEXT_CHARS * 4);
    expect(estimateTokens(uncapped)).toBeGreaterThan(500);
  });
});

describe("a realistic conversation, not just the theoretical maximum", () => {
  it("sits far under the cap for a normal turn", () => {
    // Approximates the shape that was actually failing: a real user with a
    // resume, mid-conversation, ordinary-length messages rather than maxed-out
    // ones.
    const realistic = estimateWorstCaseRequestTokens({
      systemPromptChars: SYSTEM_PROMPT_CHARS,
      historyTurns: HISTORY_TURNS,
      maxMessageChars: 400, // a typical typed question, not the 2000 cap
      maxExtraContextChars: buildResumeContext(skillsHeavyResume()).length,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      storedReplyMaxTokens: 600, // a typical Farah reply, not a maxed one
      historyMessageMaxChars: MAX_HISTORY_MESSAGE_CHARS,
    });

    expect(realistic).toBeLessThan(4000);
  });
});
