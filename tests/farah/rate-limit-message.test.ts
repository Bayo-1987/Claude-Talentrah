/**
 * send-111 — Groq's real rate-limit wait time, surfaced honestly.
 *
 * The three real message shapes below are taken verbatim from production
 * Vercel runtime-error logs (send-109's diagnosis): minutes-and-seconds
 * (the common TPD-exhaustion shape) and a synthetic seconds-only case (the
 * TPM incident's own messages were always minutes-and-seconds too, but
 * Groq's format allows a bare "Xs" and the parser has to handle it). The
 * malformed-input case is the one that matters most: a wording change on
 * Groq's side must degrade to the existing generic copy, never crash the
 * route trying to parse it.
 */
import { describe, expect, it } from "vitest";
import {
  GENERIC_FARAH_UNAVAILABLE_MESSAGE,
  farahRateLimitMessage,
  parseRetryAfterSeconds,
} from "@/lib/farah/rate-limit-message";

describe("parseRetryAfterSeconds", () => {
  it("parses a minutes-and-seconds wait (the real TPD-exhaustion shape)", () => {
    expect(
      parseRetryAfterSeconds(
        "429 Rate limit reached ... on tokens per day (TPD): Limit 200000, Used 199770, Requested 2002. Please try again in 12m45.504s.",
      ),
    ).toBeCloseTo(765.504, 3);
  });

  it("parses a seconds-only wait", () => {
    expect(parseRetryAfterSeconds("Please try again in 45.2s.")).toBeCloseTo(45.2, 3);
  });

  it("returns null for a message with no retry-after substring", () => {
    expect(parseRetryAfterSeconds("429 Rate limit reached. Contact support.")).toBeNull();
  });

  it("returns null for a message that changed wording but not this fully", () => {
    expect(parseRetryAfterSeconds("Please retry after 12 minutes.")).toBeNull();
  });
});

describe("farahRateLimitMessage", () => {
  it("rounds a minutes-and-seconds wait to the nearest minute", () => {
    // 12m45.504s = 765.504s -> 12.758 minutes -> rounds to 13.
    expect(
      farahRateLimitMessage(
        "429 Rate limit reached ... Please try again in 12m45.504s.",
      ),
    ).toBe("Farah's hit her limit for right now — try again in about 13 minutes.");
  });

  it("uses singular \"minute\" for exactly one minute", () => {
    expect(farahRateLimitMessage("Please try again in 1m0.0s.")).toBe(
      "Farah's hit her limit for right now — try again in about 1 minute.",
    );
  });

  it('falls back to the existing generic copy for a sub-minute wait, not "about 0 minutes"', () => {
    expect(farahRateLimitMessage("Please try again in 45.2s.")).toBe(GENERIC_FARAH_UNAVAILABLE_MESSAGE);
  });

  it("falls back to the existing generic message when the string doesn't parse — never throws", () => {
    expect(() => farahRateLimitMessage("429 Rate limit reached. No wait time given.")).not.toThrow();
    expect(farahRateLimitMessage("429 Rate limit reached. No wait time given.")).toBe(
      GENERIC_FARAH_UNAVAILABLE_MESSAGE,
    );
  });
});
