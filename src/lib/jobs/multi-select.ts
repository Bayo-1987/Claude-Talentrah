/**
 * Parses a comma-joined `?param=a,b` into a validated, deduped array —
 * work type and seniority's shared shape now that both are multi-select.
 *
 * Unknown values are dropped SILENTLY rather than rejected: a stale bookmark
 * or a hand-edited URL carrying a since-removed enum value should degrade to
 * "that one doesn't apply" rather than break the whole filter. Empty input
 * (no param, or a param that parsed to nothing) means "no filter" — the same
 * contract every other filter on this page already has; `.in()` is never
 * called with an empty array (jobs/page.tsx checks `.length` first), because
 * an empty `.in()` matches nothing, not everything.
 */
export function parseMultiSelect<T extends string>(
  raw: string | undefined,
  valid: readonly T[],
): T[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value && !seen.has(value) && (valid as readonly string[]).includes(value)) {
      seen.add(value);
      out.push(value as T);
    }
  }
  return out;
}
