/**
 * "Import from URL"'s request-size budget (send-136) — same discipline as
 * src/lib/farah/token-budget.ts, deliberately not shared with it.
 *
 * WHY A SEPARATE BUDGET FILE RATHER THAN REUSING FARAH'S CONSTANTS. This is a
 * different call shape with a different worst case: one-shot (no replayed
 * history — Farah's HISTORY_TURNS/MAX_HISTORY_MESSAGE_CHARS problem doesn't
 * exist here), but the single input (a fetched web page's extracted text) can
 * be far larger than a chat message, and the model must be able to return the
 * job's full description text in its output, which Farah's 1024-token CHAT
 * budget was sized for a short conversational reply, not a document. Sharing
 * one constant module across both would either starve this feature's output
 * or blow Farah's carefully-measured chat ceiling back open — see
 * farah/token-budget.ts's own header for why that ceiling exists at all
 * (production's Farah panel went down twice from exactly this class of bug,
 * CLAUDE.md's Groq TPM/TPD section). A sibling budget, not a shared one, is
 * the same choice CLAUDE.md's own MAX_JOB_CONTEXT_CHARS note makes for the
 * same reason.
 *
 * PROVIDER_TPM_LIMIT is Groq's real, documented per-minute token cap for
 * `openai/gpt-oss-120b` on the tier production runs (8,000 — see
 * farah/token-budget.ts and CLAUDE.md's Groq section) — reproduced here
 * rather than imported so this module's own test measures the REAL
 * constant this file's estimate is checked against, not a copy that can
 * drift from Farah's.
 */

/** Groq's per-minute token cap for `openai/gpt-oss-120b` — reproduced from
 * farah/token-budget.ts's PROVIDER_TPM_LIMIT (see header for why not shared). */
export const PROVIDER_TPM_LIMIT = 8000;

/**
 * Hard ceiling on the page text handed to the model, AFTER stripping
 * script/style/nav markup and collapsing whitespace (see fetch-page.ts) —
 * this is not a raw-HTML cap, extraction happens first so the budget is
 * spent on content, not markup.
 *
 * 12,000 chars (~3,000 tokens) rather than tailoring's own JD_MAX_CHARS
 * (24,000 — src/lib/tailoring/types.ts) — that number is sized for the
 * single longest REAL job posting this project has measured, deliberately
 * generous because a truncated JD costs a real user a worse tailored
 * resume. This feature has a materially different cost/benefit: the
 * employer is reviewing and editing the result regardless, an oversized
 * careers page carries proportionally more nav/footer/unrelated-postings
 * noise than a JD an employer or seeker pasted by hand, and — per
 * docs/phase-1-summary.md's "known defects" #5 — Groq's own JSON mode
 * already intermittently 400s on tailoring's largest JDs at 24,000 chars.
 * This feature should not inherit that risk while it doesn't need to.
 */
export const MAX_PAGE_TEXT_CHARS = 12_000;

/**
 * Reserved output tokens for the extraction call. Larger than Farah chat's
 * CHAT_MAX_OUTPUT_TOKENS (1,024) — a real job description can run to several
 * hundred words — but the response is JSON-schema-shaped structured fields,
 * not free-form prose, so it doesn't need tailoring's document-length budget
 * either.
 */
export const EXTRACTION_MAX_OUTPUT_TOKENS = 2000;

/** Measured length of extract.ts's own system prompt + JSON-schema
 * instruction text (see extract.ts) — kept here, next to what it's checked
 * against, so token-budget.test.ts exercises the real string rather than an
 * estimate of it. */
export const SYSTEM_PROMPT_CHARS = 1400;

/** The standard rough approximation this codebase uses everywhere it needs
 * one — see farah/token-budget.ts's header for why chars/4 and not a real
 * tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The largest single extraction request this feature can construct, given
 * the page-text truncation above. No history, no per-turn variance — the
 * worst case is simply "the page text is truncated to the max, the system
 * prompt is what it is, and the model uses its full output reservation".
 */
export function estimateWorstCaseExtractionTokens(pageTextChars: number = MAX_PAGE_TEXT_CHARS): number {
  return (
    estimateTokens("x".repeat(SYSTEM_PROMPT_CHARS)) +
    estimateTokens("x".repeat(Math.min(pageTextChars, MAX_PAGE_TEXT_CHARS))) +
    EXTRACTION_MAX_OUTPUT_TOKENS
  );
}

/** Truncates page text to the bound above. The one place this feature
 * shortens what reaches the model — everything upstream (fetch-page.ts) can
 * pass through arbitrarily large text, and everything downstream trusts that
 * this was already called. */
export function truncatePageText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_PAGE_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_PAGE_TEXT_CHARS), truncated: true };
}
