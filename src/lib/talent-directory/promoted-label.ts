/**
 * The label an employer sees on a candidate in the Promoted strip of the Talent Directory list (V5, migration 0268), and the one place its text is written. The seeker-facing copy that names the
 * strip (boost-copy.ts) imports this too, so the label and the words that describe it cannot drift apart. tests/talent-directory/promoted-label.test.tsx fails if another file under the Talent
 * Directory code spells the word.
 *
 * Client-safe: no server-only import, so the boost panel (a client component) can use it.
 */
export const PROMOTED_LABEL = "Promoted";

/**
 * True only for the exact string the database writes for a strip candidate. Anything else (a missing value, null, an empty string, a different case, a number, a word nobody defined) is NOT promoted:
 * the unmarked reading, never a claim of paid placement the database did not make. searchTalentDirectory already normalises to "promoted" | "organic"; this is the second wall, at the point of drawing.
 */
export function isPromotedSection(section: unknown): boolean {
  return section === "promoted";
}
