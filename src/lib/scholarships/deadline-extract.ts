/**
 * Pull candidate application deadlines out of a scholarship page.
 *
 * Pure text-in, dates-out, so the daily recheck's judgement is testable
 * against fixture HTML without a network. Deliberately conservative: the
 * caller only acts when extraction finds EXACTLY ONE plausible date, because
 * the failure mode this feeds is the one §6.15 calls out as the worst this
 * feature can produce — a wrong deadline costs someone a once-a-year
 * opportunity. Zero matches and five matches are both "don't touch anything".
 *
 * Why regex over an HTML parser: the pages this reads (Chevening, Gates
 * Cambridge, Knight-Hennessy) publish their deadline as prose near words like
 * "deadline" / "closes" / "open until", not as structured data — that was
 * checked per-source on 2026-09-01 (docs/scholarship-sources.md). Parsing the
 * DOM would add a dependency and still end at "find a date near a keyword".
 */

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * A date only counts when it sits within this many characters of a deadline
 * keyword. Scholarship pages are full of dates that are not deadlines —
 * result announcements, term starts, "posted on" bylines — and proximity to
 * "closes" / "deadline" / "until" is what separates them.
 */
const KEYWORD_WINDOW = 260;

const KEYWORD_PATTERN =
  /deadline|closes?|closing|open until|until|apply by|submit(?:ted)? by|applications? (?:close|must be)/gi;

/** "6 October 2026", "6th October 2026", "October 6, 2026", "2026-10-06". */
const DATE_PATTERNS: Array<{ re: RegExp; toIso: (m: RegExpExecArray) => string | null }> = [
  {
    re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
    toIso: (m) => isoFrom(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])),
  },
  {
    re: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi,
    toIso: (m) => isoFrom(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])),
  },
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    toIso: (m) => isoFrom(Number(m[1]), Number(m[2]), Number(m[3])),
  },
];

function isoFrom(year: number, month: number, day: number): string | null {
  if (!month || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject 31 February and friends rather than letting Date roll them over.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Tags out, entities that matter in, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every date (ISO yyyy-mm-dd, deduplicated, sorted) that appears near a
 * deadline keyword in the page. `onOrAfter` drops dates already in the past —
 * a page that still shows last cycle's date must not re-verify it.
 */
export function extractDeadlineCandidates(html: string, onOrAfter: string): string[] {
  const text = htmlToText(html);

  const keywordIndexes: number[] = [];
  for (const match of text.matchAll(KEYWORD_PATTERN)) {
    keywordIndexes.push(match.index ?? 0);
  }
  if (keywordIndexes.length === 0) return [];

  const found = new Set<string>();
  for (const { re, toIso } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const at = match.index;
      const nearKeyword = keywordIndexes.some((k) => Math.abs(k - at) <= KEYWORD_WINDOW);
      if (!nearKeyword) continue;
      const iso = toIso(match);
      if (iso && iso >= onOrAfter) found.add(iso);
    }
  }
  return Array.from(found).sort();
}
