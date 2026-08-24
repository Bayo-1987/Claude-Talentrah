import { createHash } from "node:crypto";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonicalization key per build-prompt §6.15: provider + program + cycle
 * year. Deliberately NOT the same function as the jobs pipeline's
 * computeDedupFingerprint (src/lib/jobs/dedup.ts) even though the hashing
 * is identical — the key *fields* differ, and the cycle year is the whole
 * point here: the same program reopening for a new intake is a genuinely
 * new listing, not a duplicate of last year's, so the year has to be part
 * of the identity rather than something that updates a row in place.
 */
export function computeScholarshipFingerprint(
  provider: string,
  programName: string,
  cycleYear: number | null,
): string {
  const key = [normalize(provider), normalize(programName), String(cycleYear ?? "")].join("|");
  return createHash("sha256").update(key).digest("hex");
}
