import { resolveCountry } from "./countries";
import { namesARealPlace } from "./extract-jd";

/**
 * The `location` text as stored, cleaned at ingestion. S12 (c).
 *
 * Measured on production (2026-10-01): 128 open postings repeated a part of their own location — Workable sends city, state
 * and country, and the state is often the city ("Lagos, Lagos, Nigeria") — and others carried a trailing ISO code
 * ("Cameroon (CM)"), a stray full stop, ragged spacing, or a template placeholder ("City, Country") stored as if it were a
 * place. This removes exactly those, and nothing else: it never invents, reorders, translates or guesses.
 *
 *  - a part that repeats an earlier part of the SAME entry (case and space insensitive) is dropped, keeping the first;
 *  - a duplicate entry (entries are `;`-separated) is dropped;
 *  - spacing is collapsed, one trailing full stop after a lowercase letter is dropped ("Congo." -> "Congo", "D.C." is left);
 *  - a trailing "(XX)" is stripped only when XX is that country's own ISO code ("Cameroon (CM)", not "Lagos (LA)");
 *  - a placeholder (the same list work-type inference uses, `namesARealPlace`) is no location at all.
 *
 * Idempotent. The first segment of the first entry is never changed by the repeat rule, but a stripped ISO code can change
 * it, so adapters keep computing the dedup FINGERPRINT from the raw string (see sources/*.ts): identity is not allowed to
 * move because the display text was tidied.
 */
export function normalizeLocation(raw: string | null | undefined): string | undefined {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!namesARealPlace(text)) return undefined;

  const seenEntries = new Set<string>();
  const entries: string[] = [];
  for (const entry of text.split(";")) {
    const seenParts = new Set<string>();
    const parts: string[] = [];
    for (const rawPart of entry.split(",")) {
      const part = tidyPart(rawPart);
      if (!part) continue;
      const key = part.toLowerCase();
      if (seenParts.has(key)) continue;
      seenParts.add(key);
      parts.push(part);
    }
    if (parts.length === 0) continue;
    const joined = parts.join(", ");
    const entryKey = joined.toLowerCase();
    if (seenEntries.has(entryKey)) continue;
    seenEntries.add(entryKey);
    entries.push(joined);
  }
  return entries.length > 0 ? entries.join("; ") : undefined;
}

function tidyPart(raw: string): string {
  let part = raw.trim();
  // "Congo." -> "Congo", but "D.C." (a capital before the stop) is an abbreviation and stays
  part = part.replace(/(?<=[a-z])\.+$/, "").trim();
  // "Cameroon (CM)" -> "Cameroon", only when CM is Cameroon's own code
  const withCode = /^(.*\S)\s*\(([A-Za-z]{2})\)$/.exec(part);
  if (withCode && resolveCountry(part) !== null) part = withCode[1]!.trim();
  return part;
}
