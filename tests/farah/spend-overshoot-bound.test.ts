/**
 * How far parallel chat requests can overshoot the daily ceiling, stated as numbers. The check reads today's total BEFORE the model call and the reply is added AFTER it completes, so requests that start
 * inside one reply's duration all pass the check against the same total. The bound does not come from our code: it comes from each provider's own limit, because spend cannot outrun what the provider admits.
 *
 * PER PROVIDER. Two providers can serve a request: Groq (the configured one) and, only when Groq answers rate-limited before its first token, the Gemini fallback.
 *   Groq: 250,000 tokens a minute. Source: console figure, unverified (the owner read it from the Groq console on 4 Oct 2026; relayed to this code, checked by no one else). All of it priced as output: $0.15.
 *   Gemini fallback: 20 requests a day, from the project's own record of the fallback key as a free-tier key (CLAUDE.md, README.md). That record is not a reading of Google's console, and nothing in the repo says
 *   whether the key has since been upgraded; if it has, this term is unknown until its limits are read. At the worst-case request the route allows, priced at the Gemini row: 20 x $0.01818 = $0.3636.
 * The two limits are independent, so WITHOUT the fallback guard the bound at the default ceiling is their sum, $0.5136 (about 51% of $1.00). WITH the guard (tests/farah/fallback-guard.test.ts) only Groq's $0.15 is left. Each bound is ABSOLUTE (it does not shrink with the ceiling), so lowering the ceiling raises its
 * share. Reserving before the call (reserve then settle) would remove the gap; it is not needed at the default and is the thing to revisit if the ceiling goes below the sum.
 */
import { describe, expect, it } from "vitest";
import { CHAT_MAX_OUTPUT_TOKENS, REQUEST_TOKEN_CEILING } from "@/lib/farah/token-budget";
import {
  DEFAULT_DAILY_CEILING_USD,
  GEMINI_FALLBACK_REQUESTS_PER_DAY,
  GEMINI_OVERSHOOT_BOUND_NANO,
  GROQ_ORG_TOKENS_PER_MINUTE,
  TOTAL_OVERSHOOT_BOUND_NANO,
  MAX_REPLY_WINDOW_SECONDS,
  NANO_PER_USD,
  OVERSHOOT_BOUND_NANO,
  estimateSpendNano,
} from "@/lib/farah/spend-ceiling";

const GROQ = { provider: "groq", model: "openai/gpt-oss-120b" };
const GEMINI = { provider: "gemini", model: "gemini-3.6-flash" };

describe("the overshoot bound", () => {
  it("is the provider's tokens-per-minute limit, all of it priced as output tokens ($0.60 per 1M): 150,000,000 nano-dollars, $0.15", () => {
    expect(GROQ_ORG_TOKENS_PER_MINUTE).toBe(250_000);
    expect(MAX_REPLY_WINDOW_SECONDS).toBe(60);
    expect(OVERSHOOT_BOUND_NANO).toBe(150_000_000);
    expect(OVERSHOOT_BOUND_NANO).toBe(estimateSpendNano({ ...GROQ, inputTokens: 0, outputTokens: GROQ_ORG_TOKENS_PER_MINUTE }));
  });

  it("is 15% of the default ceiling, and the SAME dollars (a larger share) at a lower ceiling", () => {
    const ceilingNano = DEFAULT_DAILY_CEILING_USD * NANO_PER_USD;
    expect(OVERSHOOT_BOUND_NANO / ceilingNano).toBeCloseTo(0.15 / DEFAULT_DAILY_CEILING_USD, 10);
    expect(OVERSHOOT_BOUND_NANO / (0.5 * NANO_PER_USD)).toBeCloseTo(0.3, 10);
  });

  it("holds for the two ways to fill a minute of tokens: typical replies (2,400 in + 470 out) and the largest the request caps allow (7,000 in + 1,024 out)", () => {
    const typicalTokens = 2400 + 470;
    const typicalCount = Math.floor(GROQ_ORG_TOKENS_PER_MINUTE / typicalTokens); // 87 replies
    expect(typicalCount * estimateSpendNano({ ...GROQ, inputTokens: 2400, outputTokens: 470 })).toBeLessThanOrEqual(OVERSHOOT_BOUND_NANO);

    const largestTokens = REQUEST_TOKEN_CEILING + CHAT_MAX_OUTPUT_TOKENS;
    const largestCount = Math.floor(GROQ_ORG_TOKENS_PER_MINUTE / largestTokens); // 31 replies
    const largestCost = estimateSpendNano({ ...GROQ, inputTokens: REQUEST_TOKEN_CEILING, outputTokens: CHAT_MAX_OUTPUT_TOKENS });
    expect(largestCost).toBe(1_664_400);
    expect(largestCount * largestCost).toBeLessThanOrEqual(OVERSHOOT_BOUND_NANO);
  });

  it("Groq's bound is the ONLY term when Groq serves; the fallback has its own, per request (Gemini row: 7,000 in + 1,024 out = 18,180,000 nano-dollars) times its 20 requests a day", () => {
    expect(GEMINI_FALLBACK_REQUESTS_PER_DAY).toBe(20);
    const worstGeminiRequest = estimateSpendNano({ ...GEMINI, inputTokens: REQUEST_TOKEN_CEILING, outputTokens: CHAT_MAX_OUTPUT_TOKENS });
    expect(worstGeminiRequest).toBe(18_180_000);
    expect(GEMINI_OVERSHOOT_BOUND_NANO).toBe(GEMINI_FALLBACK_REQUESTS_PER_DAY * worstGeminiRequest);
    expect(GEMINI_OVERSHOOT_BOUND_NANO).toBe(363_600_000);
  });

  it("the two limits are independent, so the bound at the default ceiling is their sum: 513,600,000 nano-dollars, $0.5136, 51.36% of $1.00", () => {
    expect(TOTAL_OVERSHOOT_BOUND_NANO).toBe(OVERSHOOT_BOUND_NANO + GEMINI_OVERSHOOT_BOUND_NANO);
    expect(TOTAL_OVERSHOOT_BOUND_NANO).toBe(513_600_000);
    expect(TOTAL_OVERSHOOT_BOUND_NANO / (DEFAULT_DAILY_CEILING_USD * NANO_PER_USD)).toBeCloseTo(0.5136, 10);
  });

  it("one reply at the largest size is 0.17% of the default ceiling", () => {
    expect(1_664_400 / (DEFAULT_DAILY_CEILING_USD * NANO_PER_USD)).toBeLessThan(0.002);
  });
});
