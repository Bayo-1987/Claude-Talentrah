import { inputValue, selectKey, type SubmittedValues } from "@/lib/forms/keep-input";

/**
 * The key and the default of a <select> that has BOTH a saved value (a prop) and a typed value (the returned values after a refused save), computed together.
 *
 * A <select> reads `defaultValue` only when it mounts, so to show a different choice it has to be remounted, which a changed `key` does. `selectKey` alone follows only the typed value; when a refused save
 * is followed by a successful one, the key changed before the revalidated saved value reached the page, the select remounted with the OLD saved value and showed it (and the next Save wrote it back).
 * Putting the saved value into the key as well means the key changes whenever the default does, including when the revalidated value lands. Same idea as src/lib/admin/catalog/tier-select.ts, for any field.
 */
export function savedSelect(
  field: string,
  saved: string | null | undefined,
  values: SubmittedValues | undefined,
): { key: string; defaultValue: string } {
  return {
    key: `${saved ?? ""}|${selectKey(values, field)}`,
    defaultValue: inputValue(values, field, saved ?? ""),
  };
}
