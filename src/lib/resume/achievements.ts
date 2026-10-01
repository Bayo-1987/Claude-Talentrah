/**
 * One achievement per bullet.
 *
 * A bullet that carries its own marker ("• Led…", "- Led…", "1. Led…"), or
 * several achievements glued into one string, renders as a fake dash inside a
 * paragraph instead of a real `<li>`. These helpers turn that text into the
 * `string[]` a resume stores (`ResumeExperienceEntry.bullets`) — markers
 * removed, one achievement per entry.
 *
 * No imports: used by `getExperienceBullets` (resume/types.ts, read by every
 * template), by tailoring-time normalisation, and when a reviewed rewrite is
 * accepted.
 */

/**
 * A list marker at the START of a line: a bullet glyph, a dash, an asterisk
 * or a number — and only when followed by whitespace, so "-5% churn",
 * "**Led** the team", "24/7 on-call" and "2022 launch" are text, not markers.
 */
const LINE_MARKER = /^\s*(?:[•●▪◦·–—*-]|\d{1,2}[.)])\s+/;

/**
 * Bullet GLYPHS that separate achievements glued onto one line
 * ("• A • B"). Narrower than LINE_MARKER on purpose: a hyphen or a middle dot
 * inside a sentence ("Ran ops · finance · people") is punctuation, and only a
 * proper bullet glyph is unambiguous enough to split on mid-line.
 */
const GLUED_SEPARATOR = /(?:^|\s)[•●▪◦]\s+/;
const GLUED_SEPARATOR_GLOBAL = new RegExp(GLUED_SEPARATOR.source, "g");

/** Removes one leading list marker and trims. Text without a marker is only trimmed. */
export function stripBulletMarker(line: string): string {
  return line.replace(LINE_MARKER, "").trim();
}

/**
 * Splits text into achievements: one per line, and one per bullet glyph when
 * several are glued onto a line. Markers are stripped and blanks dropped. A
 * plain sentence stays one achievement.
 */
export function splitAchievements(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const piece of line.split(GLUED_SEPARATOR_GLOBAL)) {
      const cleaned = stripBulletMarker(piece);
      if (cleaned.length > 0) items.push(cleaned);
    }
  }
  return items;
}

/**
 * If a `description` is really a typed list — two or more lines that ALL start
 * with a marker, or two or more bullet glyphs glued onto one line — returns
 * its achievements; otherwise `undefined`. Deliberately strict: two plain
 * paragraphs are two paragraphs, and a single "- " line is not a list.
 */
export function achievementsFromTypedList(description: string | undefined): string[] | undefined {
  if (!description) return undefined;
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const everyLineMarked = lines.length >= 2 && lines.every((line) => LINE_MARKER.test(line));
  const gluedGlyphs = (description.match(GLUED_SEPARATOR_GLOBAL) ?? []).length >= 2;
  if (!everyLineMarked && !gluedGlyphs) return undefined;
  const items = splitAchievements(description);
  return items.length >= 2 ? items : undefined;
}
