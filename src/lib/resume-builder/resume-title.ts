/**
 * Default and user-supplied titles for a builder resume.
 *
 * THE BUG THIS FIXES. `createResumeAction` used `title: template.name`, full
 * stop. Start from the gallery twice with the same template and you get two
 * rows called "Clean Professional", indistinguishable in the list, both
 * linking to different content. Until Stage 10 there was no rename control
 * either, so the collision was permanent.
 *
 * THE OTHER CREATION PATH ALREADY DID THIS RIGHT and is deliberately left
 * alone: /api/tailoring names its output `Tailored — {job title}` and
 * `Cover letter — {job title}` from `result.structuredJd.title`, falling back
 * to a bare "Tailored resume" when the JD has no parseable title. That is
 * already "the target job's title where one is known", so there is nothing to
 * change there — verified in the route, not assumed from the shape of the
 * feature.
 *
 * NO BACKFILL. Existing duplicates are fixed by the rename control, not by a
 * migration guessing at what the user meant.
 */

/** Longest title the list can show without the row wrapping unreadably. */
export const MAX_RESUME_TITLE_LENGTH = 80;

/**
 * "Clean Professional — Sep 4".
 *
 * Day-level, not time-level: two resumes started in the same minute is a real
 * case (a mis-click, a back button) and a timestamp would make the list read
 * like a log. Same-day repeats stay ambiguous by design — that is what rename
 * is for, and a machine-generated "(2)" suffix would be a worse answer than
 * asking.
 *
 * `en-US` is pinned rather than left to the server's locale so the format does
 * not depend on where this happens to run; the app's copy is English
 * throughout. `new Date()` is injectable so a test can assert the exact string
 * rather than reconstructing today's date and hoping.
 */
export function defaultBuilderResumeTitle(templateName: string, now: Date = new Date()): string {
  const stamp = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return truncateResumeTitle(`${templateName} — ${stamp}`);
}

function truncateResumeTitle(title: string): string {
  return title.length > MAX_RESUME_TITLE_LENGTH
    ? title.slice(0, MAX_RESUME_TITLE_LENGTH).trimEnd()
    : title;
}

/**
 * What a rename is allowed to store.
 *
 * Returns null for anything that is not a usable title, so the caller reports
 * a refusal rather than silently writing "" — `resumes.title` is `not null`
 * with a default, and an empty string satisfies that constraint while making
 * the row unnameable in the list.
 */
export function normalizeResumeTitle(raw: string): string | null {
  // Collapse whitespace, including the newlines a paste can carry in.
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return truncateResumeTitle(cleaned);
}
