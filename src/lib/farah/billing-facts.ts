import { CREDIT_PACKS, PASSES } from "@/lib/billing/catalog";
import { creditPriceList } from "@/lib/credits/price-list";
import { creditsPhrase } from "@/lib/credits/price-labels";
import { paidMessageCredits } from "@/lib/credits/farah-message-charge";
import { AUTO_APPLY_FREE_PER_WEEK } from "@/lib/auto-apply/config";

/**
 * The facts block the billing chips hand to Farah. Built on the SERVER from its own catalog (packs, Passes, the credit price list, the allowances) and from the user's own numbers the chat gate already read for this
 * request (their balance and their free-message count). Nothing the client sends is an input: the route calls this with the gate's result, and ignores any price, balance or facts the request body carries.
 *
 * Plain numbers and catalog names only (no user text, no brackets), so it cannot carry an instruction and cannot close its own block. It is sent after the chip's instructions inside <platform_facts> (chat-prompt.ts).
 */
export const MAX_FACTS_CHARS = 1800;

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export interface BillingFactsInput {
  /** The user's credit balance as the gate read it for this request. */
  balance: number;
  /** Farah's free-message allowance and its rolling window (chat-gate.ts). */
  farahFreeAllowance: number;
  farahFreeWindowDays: number;
  /** Free Farah messages left BEFORE this one; null for an account an active Pass covers (no count to quote). */
  farahFreeLeft: number | null;
}

export function buildBillingFacts(i: BillingFactsInput): string {
  const lines: string[] = [];
  lines.push("Prices of actions that cost credits (Talentrah's price list):");
  for (const e of creditPriceList()) lines.push(`- ${e.label}: ${creditsPhrase(e.cost)}`);
  lines.push("Credit packs:");
  for (const p of CREDIT_PACKS) lines.push(`- ${p.name}: ${p.credits} credits for ${naira(p.price_ngn)}`);
  lines.push("Passes:");
  for (const p of PASSES) lines.push(`- ${p.name}: ${p.duration_days} days for ${naira(p.price_ngn)}`);
  lines.push("An active Pass covers Farah messages (within a daily fair-use cap), resume tailoring runs and cover letters, so they use no credits while it lasts.");
  lines.push("What is free, and how each allowance renews:");
  lines.push(`- Auto-Apply: ${AUTO_APPLY_FREE_PER_WEEK} confirmed applications a week, then each one costs credits. Opening an external posting is always free.`);
  lines.push(`- Farah: ${i.farahFreeAllowance} free messages in a rolling ${i.farahFreeWindowDays} days (not a weekly allowance), then ${creditsPhrase(paidMessageCredits())} per message.`);
  lines.push("- Your first resume tailoring run and your first cover letter: free, one time each.");
  lines.push("This user's account:");
  lines.push(`- Credit balance: ${creditsPhrase(i.balance)}.`);
  if (i.farahFreeLeft !== null) lines.push(`- Free Farah messages left: ${i.farahFreeLeft}.`);
  const text = lines.join("\n");
  if (text.length > MAX_FACTS_CHARS) throw new Error(`billing facts are ${text.length} characters, over the cap of ${MAX_FACTS_CHARS}`);
  return text;
}
