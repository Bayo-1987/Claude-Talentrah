import { selectKey, inputValue, type SubmittedValues } from "@/lib/forms/keep-input";

/**
 * The key and the default of a catalog row's Price tier <select>, computed together.
 *
 * A <select> reads `defaultValue` only when it mounts; React ignores a later change to it. So to show a different tier the select has to be REMOUNTED, which a changed `key` does. Two inputs decide what
 * it should show: the tier the row has saved (a prop, and it changes when a save succeeds and the page is revalidated) and the tier typed in a refused save (`values`, so a refused save keeps the choice).
 * #885 keyed the select by the second only; on a successful save the key changed and the select remounted with the FIRST as it was before the revalidated row arrived, so it showed the old tier
 * (QA COURSE-TIER-1) and the next Save wrote the old tier back. Here both inputs go into the key, so the key changes whenever the default does and not otherwise.
 */
export function tierSelect(savedTier: string, values: SubmittedValues | undefined): { key: string; defaultValue: string } {
  return {
    key: `${savedTier}|${selectKey(values, "price_tier")}`,
    defaultValue: inputValue(values, "price_tier", savedTier),
  };
}
