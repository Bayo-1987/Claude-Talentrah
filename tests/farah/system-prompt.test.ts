/**
 * send-398 — Farah's live chat answered "How do credits work?" by inventing
 * a "starter pack" of credits granted at signup. There is no knowledge-base
 * document or retrieved content behind that answer: FARAH_SYSTEM_PROMPT
 * (this file's subject) is the ONLY credits-related grounding sent with
 * every Farah call (askFarah, askFarahChat, askFarahChatStream — see
 * src/lib/farah/client.ts, which appends nothing credits-related of its
 * own), so before this fix the model had zero real information about
 * credits mechanics and filled the gap with a plausible-sounding but false
 * freemium narrative. New accounts actually start at 0 credits
 * (0000_baseline_schema.sql's `profiles.credits_balance` default, confirmed
 * against src/lib/tailoring/gate.ts's free_trial_tailoring_used /
 * free_trial_cover_letter_used one-time flags) — nothing is granted as a
 * stockpile.
 *
 * This test can only assert the STATIC grounding text is correct — it
 * cannot prove the live model obeys it (that needs a real provider call,
 * done once by hand as part of this fix, not repeated here to protect
 * Groq's shared daily token budget — see CLAUDE.md's Groq TPD section).
 * Treat this as the mechanical half of the fix's verification, not the
 * whole thing.
 *
 * send-412 correction: the fix above introduced its own absolute claim —
 * "credits are only ever bought, never granted" — which is false. A
 * successful referral grants real credits with zero purchase involved
 * (grant_referral_reward, hardened atomic in 0163_atomic_referral_reward_
 * grant.sql). Same mistake shape as the original bug, just relocated to a
 * narrower claim; the last two tests below guard against both directions.
 */
import { describe, expect, it } from "vitest";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";

describe("FARAH_SYSTEM_PROMPT credits framing", () => {
  it("never tells Farah to describe a signup credit grant as a starter pack or allotment", () => {
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    expect(lower).not.toContain("starter pack");
    expect(lower).not.toContain("starter-pack");
    // "allotment" / "stockpile" are the FAQ's own pre-fix wording
    // (src/components/marketing/faq-section.tsx, send-388's separate scope)
    // for the same wrong claim — Farah's prompt must not reintroduce it.
    expect(lower).not.toContain("free allotment");
  });

  it("tells Farah new accounts start at 0 credits, with one free tailoring run and one free cover letter", () => {
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("0 credits");
    expect(lower).toMatch(/first resume tailoring run/);
    expect(lower).toMatch(/first cover letter/);
  });

  it("does not claim credits are only ever bought, never granted — referrals genuinely grant them", () => {
    // send-412: this exact absolute was the fix's own regression, introduced
    // while removing the "starter pack" one — grant_referral_reward()
    // (0000_baseline_schema.sql, hardened atomic in 0163) genuinely credits
    // a referrer with no purchase involved, a real, intentional feature
    // (build-prompt's "Refer & Earn (credits-only)"), not an edge case.
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    expect(lower).not.toMatch(/credits are only ever bought, never granted/);
    expect(lower).not.toMatch(/\bonly ever bought\b/);
  });

  it("tells Farah a referral is a real, non-purchase way to earn credits, without a hardcoded reward amount", () => {
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/referral/);
    expect(lower).toMatch(/earns? real credits|earns? credits/);
    expect(lower).toMatch(/no purchase involved|without (a )?purchase/);
    // The real reward (5-40 credits, 0092_referral_reward_repricing.sql) is
    // a number that can be repriced independently of this prompt — same
    // discipline as not quoting an exact credit price.
    expect(lower).not.toMatch(/\b5\b.*\b40\b credits|\b40\b.*\b5\b credits/);
  });
});
