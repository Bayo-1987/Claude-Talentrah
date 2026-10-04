/**
 * How far parallel chat requests can overshoot the daily ceiling, stated as numbers. The check reads today's total BEFORE the model call and the reply is added AFTER it completes, so requests that start
 * inside one reply's duration all pass the check against the same total. The bound does not come from our code: it comes from the provider's own organisation limit on tokens per minute (250,000, read from
 * Groq's console on 4 Oct 2026), because spend cannot outrun the tokens the provider admits. The bound is ABSOLUTE (it does not shrink with the ceiling), so lowering the ceiling raises its share:
 * 15% of the $1.00 default, 30% at $0.50. Reserving before the call (reserve then settle) would remove the gap; it is not needed at the default and is the thing to revisit if the ceiling goes below ~$0.50.
 */
import { describe, expect, it } from "vitest";
import { CHAT_MAX_OUTPUT_TOKENS, REQUEST_TOKEN_CEILING } from "@/lib/farah/token-budget";
import {
  DEFAULT_DAILY_CEILING_USD,
  GROQ_ORG_TOKENS_PER_MINUTE,
  MAX_REPLY_WINDOW_SECONDS,
  NANO_PER_USD,
  OVERSHOOT_BOUND_NANO,
  estimateSpendNano,
} from "@/lib/farah/spend-ceiling";

const GROQ = { provider: "groq", model: "openai/gpt-oss-120b" };

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

  it("one reply at the largest size is 0.17% of the default ceiling", () => {
    expect(1_664_400 / (DEFAULT_DAILY_CEILING_USD * NANO_PER_USD)).toBeLessThan(0.002);
  });
});
