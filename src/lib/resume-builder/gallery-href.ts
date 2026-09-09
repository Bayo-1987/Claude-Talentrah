/**
 * Builds a `/resume-builder` URL from the gallery's current filter state
 * plus whatever's changing — `category`, `q`, `atsSafe`, and `freeOnly`
 * (send-119) all compose through the same `base`/`changes` merge, so
 * toggling one filter's link never silently drops another that's already
 * active. Pulled out of page.tsx so that composition is unit-testable
 * directly, rather than trusted from reading the JSX — exactly the kind of
 * thing a new filter added to an existing multi-param query is easy to get
 * wrong.
 */
export function buildGalleryHref(
  base: Record<string, string | undefined>,
  changes: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...changes };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/resume-builder?${qs}` : "/resume-builder";
}
