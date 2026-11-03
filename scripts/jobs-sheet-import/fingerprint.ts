/**
 * Identity of an imported row (JOBS-SHEET-IMPORT-1, ruling B3). There is no external_id column: the only identity the table enforces is `dedup_fingerprint` (UNIQUE), which the ingest
 * pipeline computes from company + title + first location (src/lib/jobs/dedup.ts). The import uses the SAME function, so a job that is already on Talentrah from a source has the same
 * fingerprint and the import skips it (INSERT ... ON CONFLICT DO NOTHING; an existing row is never updated).
 *
 * Two rows of ONE import that share a fingerprint but are different requisitions (a different apply address) get the apply address mixed in, exactly as ingest.ts does for two
 * postings of one fetch (`disambiguateFingerprint`); two rows with the same fingerprint AND the same apply address are one job listed twice, and the later one is a duplicate.
 */
import { computeDedupFingerprint, disambiguateFingerprint } from "../../src/lib/jobs/dedup";

export interface FingerprintInput {
  company: string;
  title: string;
  /** The first location only (the same input ingest uses), or null. */
  location: string | null;
  /** The apply address (the cleaned link): what tells two requisitions of one company, title and place apart. */
  applyKey: string;
}

export type FingerprintResult = { fingerprint: string; duplicateOfIndex: null } | { fingerprint: null; duplicateOfIndex: number };

export function baseFingerprint(input: Pick<FingerprintInput, "company" | "title" | "location">): string {
  return computeDedupFingerprint(input.company, input.title, input.location ?? undefined);
}

/** One result per input, in order. Pure and deterministic: the same sheet always yields the same fingerprints. */
export function assignFingerprints(inputs: readonly FingerprintInput[]): FingerprintResult[] {
  const seen = new Map<string, number>(); // fingerprint -> index of the row that holds it
  const applyKeyOf = new Map<string, string>(); // base fingerprint -> apply key of the first row that used it
  return inputs.map((input, index) => {
    const base = baseFingerprint(input);
    if (!seen.has(base)) {
      seen.set(base, index);
      applyKeyOf.set(base, input.applyKey);
      return { fingerprint: base, duplicateOfIndex: null };
    }
    if (applyKeyOf.get(base) === input.applyKey) return { fingerprint: null, duplicateOfIndex: seen.get(base) as number };
    const unique = disambiguateFingerprint(base, input.applyKey);
    if (seen.has(unique)) return { fingerprint: null, duplicateOfIndex: seen.get(unique) as number };
    seen.set(unique, index);
    return { fingerprint: unique, duplicateOfIndex: null };
  });
}
