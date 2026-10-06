/**
 * Everything credits pay for, with its price (send-503, S18).
 *
 * The billing page used to say "Credits cover AI tailoring runs, cover letters, and premium templates", which left out bullet
 * rewrites, Farah messages, scholarship checks, directory verification and boosts. This list is built FROM `CREDIT_COSTS`, through
 * the `priced()` helper every spender button uses (send-493): the labels table below is typed as a Record over the cost keys, so
 * adding an action to CREDIT_COSTS without a label here is a compile error, and a repricing moves the page with it.
 */
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { priced } from "@/lib/credits/price-labels";

type CostKey = keyof typeof CREDIT_COSTS;

/** Plain, seeker-facing names ("Resume", never "CV"), in the order a person meets them. */
const LABELS: Record<CostKey, string> = {
  tailoringRun: "Tailor a resume",
  coverLetterRun: "Cover letter",
  bulletRewrite: "Bullet rewrite",
  farahChatMessage: "Farah message",
  autoApplySubmission: "Auto-Apply submission",
  scholarshipEligibilityCheck: "Scholarship eligibility check",
  scholarshipSopDraft: "Scholarship statement draft",
  templateUnlock: "Premium resume template",
  talentDirectoryVerification: "Talent Directory resume review",
  talentDirectoryHumanReview: "Talent Directory resume review by a mentor",
  talentDirectoryBoost: "Talent Directory boost",
};

export interface CreditPriceEntry {
  key: CostKey;
  label: string;
  cost: number;
  /** "Tailor a resume · 20 credits" */
  text: string;
}

export function creditPriceList(): CreditPriceEntry[] {
  return (Object.keys(LABELS) as CostKey[]).map((key) => ({
    key,
    label: LABELS[key],
    cost: CREDIT_COSTS[key],
    text: priced(LABELS[key], CREDIT_COSTS[key]),
  }));
}
