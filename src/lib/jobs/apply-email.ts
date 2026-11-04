/**
 * "Apply by email": the one place an address stored on a posting (`job_postings.apply_email`) is judged and turned into a link.
 *
 * Every surface that shows the address or builds the mailto link goes through here, so the rule exists once. It is an ALLOWLIST that REFUSES and never repairs:
 * a value that is not one plain ASCII address comes back null. Trim and lower-case are the only changes made. That is what keeps a stored value from putting a
 * second recipient, a header (`?cc=`, `%0ABcc:`), a fragment or a display name into the mailto link, whoever wrote it and however it got there.
 *
 *   local part  [a-zA-Z0-9._+-], 1 to 64 characters, not starting or ending with "." and with no ".."
 *   domain      two or more labels split by ".", each [a-zA-Z0-9-] with no leading or trailing "-" and never empty
 *   whole       one "@", at most 254 characters (the database CHECK, 0274, says the same)
 *
 * Non-ASCII is refused on the original text BEFORE lower-casing: some characters lower-case to a plain ASCII letter (the Kelvin sign becomes "k"), which would
 * turn a refused value into an accepted one.
 */

/** Same limit as the CHECK on the column (0274_job_postings_apply_email.sql). */
export const APPLY_EMAIL_MAX_LENGTH = 254;
/** The job title is cut to this many characters (code points) before it goes into the subject. */
export const APPLY_EMAIL_SUBJECT_TITLE_MAX = 120;

const LOCAL_PART = /^[a-zA-Z0-9._+-]{1,64}$/;
const DOMAIN_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

/** The address to show and to link, or null when the stored value is empty or not one plain address. Never a repaired value. */
export function normaliseApplyEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > APPLY_EMAIL_MAX_LENGTH) return null;

  const parts = trimmed.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;

  if (!LOCAL_PART.test(local)) return null;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;

  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return null;

  return trimmed.toLowerCase();
}

/** A title that can be encoded: a lone surrogate would make encodeURIComponent throw, and a cut through an emoji would leave one. */
function titleForSubject(title: unknown): string {
  if (typeof title !== "string") return "";
  const wellFormed = title.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  return Array.from(wellFormed).slice(0, APPLY_EMAIL_SUBJECT_TITLE_MAX).join("");
}

/**
 * `mailto:<address>?subject=<encoded "Application: <title>">`, or null when the address is refused.
 * The only query parameter is the subject, and the subject is always percent-encoded, so nothing in a title can add a recipient or a header.
 */
export function applyEmailHref(rawAddress: unknown, title: unknown): string | null {
  const address = normaliseApplyEmail(rawAddress);
  if (address === null) return null;
  return `mailto:${address}?subject=${encodeURIComponent(`Application: ${titleForSubject(title)}`)}`;
}
