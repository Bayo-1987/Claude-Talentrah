/**
 * Up to two initials for an organisation name, or null.
 *
 * ── WHY THIS IS A FUNCTION AND NOT FOUR LINES IN THE LAYOUT ───────────────
 *
 * It was four lines in the layout, ending `|| "—"`, and that em dash rendered
 * inside the masthead's 34x34 solid-ink square — a badge that looked broken on
 * the one screen where having no organisation is normal.
 *
 * Fixing it to `|| null` is a one-character change that nothing would catch if
 * it came back: the masthead prop is `string | null`, so a dash typechecks
 * perfectly, and the component's own tests pass null directly and would never
 * see it. Extracted so the rule "no name means no initials" has somewhere to
 * be asserted.
 *
 * NULL RATHER THAN AN EMPTY STRING, because the caller renders on truthiness
 * and an empty string would produce an empty black square — the same visual
 * defect with a different cause.
 */
export function orgInitials(orgName: string | null | undefined): string | null {
  return (
    (orgName ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || null
  );
}
