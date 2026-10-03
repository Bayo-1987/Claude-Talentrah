import { AUTO_APPLY_FREE_PER_WEEK } from "./config";

/**
 * Words for Auto-Apply's limits that other pages embed (S1-26 item 2). The numbers are the enforced constants in ./config, never
 * typed at the call site, so a retune of the limit changes every sentence that names it.
 */

/** "your 5 free weekly applications": the free allowance, for the billing page's Pass copy (which says a Pass covers Auto-Apply beyond it). */
export function autoApplyFreeRunsPhrase(): string {
  return `your ${AUTO_APPLY_FREE_PER_WEEK} free weekly applications`;
}
