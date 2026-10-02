/**
 * send-501 — finds copy that tells a visitor they need an account to BROWSE jobs or scholarships.
 *
 * /jobs and /scholarships are public landing pages (send-484, send-480). A sentence that says
 * "create a free account to browse them" is therefore false, and it is the shape the audit found
 * three times (the homepage's job-board section, the scholarship hub card, and the pre-fix auth
 * panel's cousin). What genuinely needs an account is the personal part — match scores against
 * your resume, Farah's eligibility check — and copy must say THAT, not "browse".
 *
 * "to SEE how well each matches your resume" is deliberately not flagged: a match score really does
 * need an account, and that is the sentence copy SHOULD say.
 *
 * Deliberately narrow: it flags only the gating shape ("create/need/require … account … to
 * browse/search/explore") with jobs/roles/scholarships/catalog in the surrounding window.
 * Mentorship is not a false positive by construction: its list and profiles really are
 * authenticated-only, and its sentence is about mentors, not jobs or scholarships.
 */

/** "Create a free account to browse", "an account is required to search", "you need an account to explore". */
const GATING_SHAPE =
  /\b(?:creat\w*|sign(?:ing)?\s*up|need\w*|requires?|required)\b[^.!?]{0,40}\baccount\b[^.!?]{0,20}\bto\s+(?:browse|search|explore)\b/gi;

const SUBJECT = /\b(?:jobs?|roles?|scholarships?|catalog(?:ue)?|listings?)\b/i;

const WINDOW = 160;

/** JSX text to plain text: tags and entities out, every run of whitespace (including line breaks) to one space. */
export function flattenMarkup(source: string): string {
  return source
    .replace(/\{["'`]([^"'`{}]*)["'`]\}/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&apos;|&rsquo;|&#39;|&#x27;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ");
}

/** Every passage in `source` that claims an account is needed to browse jobs or scholarships. */
export function findGatedBrowseClaims(source: string): string[] {
  const text = flattenMarkup(source);
  const hits: string[] = [];
  for (const match of text.matchAll(GATING_SHAPE)) {
    const start = Math.max(0, match.index - WINDOW);
    const end = Math.min(text.length, match.index + match[0].length + WINDOW);
    if (SUBJECT.test(text.slice(start, end))) hits.push(text.slice(Math.max(0, match.index - 40), end).trim());
  }
  return hits;
}
