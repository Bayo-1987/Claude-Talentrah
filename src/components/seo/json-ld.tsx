/**
 * A <script type="application/ld+json"> block, escaped once, in one place.
 *
 * JSON.stringify does not escape `<`, so a "</script>" appearing inside any
 * string field closes the tag early and everything after it becomes markup.
 * Replacing `<` with its < escape is the fix, and it is the kind of
 * detail that is correct at the first call site and forgotten at the third —
 * so there is one call site's worth of it here and the builders return plain
 * objects.
 *
 * Renders nothing for a null payload, so callers can pass a builder's result
 * straight through: every builder in lib/seo returns null rather than emit
 * markup it cannot stand behind.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
