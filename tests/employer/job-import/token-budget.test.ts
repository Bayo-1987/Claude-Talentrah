/**
 * "Import from URL"'s request-size budget (src/lib/employer/job-import/token-budget.ts).
 *
 * Same shape as tests/farah/token-budget.test.ts / the discipline described
 * in that file's own header: this measures the REAL
 * exported constants, not a copy of them, so the guard actually fails if the
 * budget or the system prompt drift apart — see extract.ts's SYSTEM_PROMPT
 * and this module's SYSTEM_PROMPT_CHARS comment for why that pairing matters.
 */
import { describe, expect, it } from "vitest";
import {
  EXTRACTION_MAX_OUTPUT_TOKENS,
  MAX_PAGE_TEXT_CHARS,
  PROVIDER_TPM_LIMIT,
  SYSTEM_PROMPT_CHARS,
  estimateTokens,
  estimateWorstCaseExtractionTokens,
  truncatePageText,
} from "@/lib/employer/job-import/token-budget";

describe("estimateWorstCaseExtractionTokens", () => {
  it("stays under Groq's real TPM ceiling with real headroom, not by accident", () => {
    const worstCase = estimateWorstCaseExtractionTokens();
    expect(worstCase).toBeLessThan(PROVIDER_TPM_LIMIT);
    // Real headroom, not "just barely" — Farah's own token-budget.ts treats
    // the gap to PROVIDER_TPM_LIMIT as intentional slack for chars/4's
    // under-counting, not spend-later margin. Same discipline here.
    expect(PROVIDER_TPM_LIMIT - worstCase).toBeGreaterThan(500);
  });

  it("scales with a smaller page but never exceeds the bound for a larger one", () => {
    const small = estimateWorstCaseExtractionTokens(500);
    const atCap = estimateWorstCaseExtractionTokens(MAX_PAGE_TEXT_CHARS);
    const wayOverCap = estimateWorstCaseExtractionTokens(MAX_PAGE_TEXT_CHARS * 100);
    expect(small).toBeLessThan(atCap);
    // Passing something far larger than the cap must NOT blow the estimate
    // past the cap's own worst case — this is what proves the function
    // itself clamps to MAX_PAGE_TEXT_CHARS rather than trusting its caller to
    // have already truncated.
    expect(wayOverCap).toBe(atCap);
  });

  it("matches a hand-computed worst case at the real constants (regression pin)", () => {
    const expected =
      estimateTokens("x".repeat(SYSTEM_PROMPT_CHARS)) +
      estimateTokens("x".repeat(MAX_PAGE_TEXT_CHARS)) +
      EXTRACTION_MAX_OUTPUT_TOKENS;
    expect(estimateWorstCaseExtractionTokens()).toBe(expected);
  });
});

describe("truncatePageText", () => {
  it("passes short text through untouched", () => {
    const { text, truncated } = truncatePageText("A short job description.");
    expect(text).toBe("A short job description.");
    expect(truncated).toBe(false);
  });

  it("truncates text over the bound, and reports that it did", () => {
    const oversized = "B".repeat(MAX_PAGE_TEXT_CHARS + 10_000);
    const { text, truncated } = truncatePageText(oversized);
    expect(text.length).toBe(MAX_PAGE_TEXT_CHARS);
    expect(truncated).toBe(true);
  });

  it("text at exactly the bound is not marked truncated", () => {
    const exact = "C".repeat(MAX_PAGE_TEXT_CHARS);
    const { truncated } = truncatePageText(exact);
    expect(truncated).toBe(false);
  });
});
