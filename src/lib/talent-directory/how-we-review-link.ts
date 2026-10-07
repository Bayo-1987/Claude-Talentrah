import { safeRedirectTo } from "@/lib/auth/redirect-to";
import { HOW_WE_REVIEW_PATH } from "@/lib/talent-directory/review-badge";

/**
 * Where "How we review" can send a person back to (HWR-1). The page used to be a dead end for a signed-in employer or seeker: every link to it is now
 * `/how-we-review-resumes?from=<the page they came from>`, and the page shows "← Back to <label>".
 *
 * An ALLOW-LIST, never "any path": the value arrives in a query string, so it is attacker-controlled. It must be one of these exact paths, and it carries only a path:
 * no id, no query, no fragment, no personal data. That is why the candidate page and the applicants page (whose own paths hold a candidate id and a job id) are not
 * here: they link with their parent list's path (`/employer/talent-directory` and `/employer/jobs`), which is where Back takes the person.
 */
export const HOW_WE_REVIEW_BACK_TARGETS: Readonly<Record<string, string>> = {
  "/employer/talent-directory": "Talent Directory",
  "/employer/jobs": "Jobs Posted",
  "/talent-directory/verify": "Talent Directory",
};

/**
 * The Back link for a `from` value, or null (no link). First the repo's own safe-redirect check (a same-site path: refuses "//host", a scheme such as "http:" or
 * "javascript:", and a backslash variant), then an EXACT match on the allow-list: a padded, differently cased, longer or id-carrying path is not a match, and a
 * value that is not a string is not either.
 */
export function backLinkFor(raw: unknown): { href: string; label: string } | null {
  if (typeof raw !== "string") return null;
  const safe = safeRedirectTo(raw, "");
  if (safe === "" || safe !== raw) return null; // not a same-site path, or padded (safeRedirectTo trims)
  if (!Object.hasOwn(HOW_WE_REVIEW_BACK_TARGETS, safe)) return null;
  return { href: safe, label: HOW_WE_REVIEW_BACK_TARGETS[safe] };
}

/** The one place the link to the page is built: with `from` only when it is allowed, the plain page otherwise. */
export function howWeReviewHref(from?: string | null): string {
  const link = backLinkFor(from);
  return link ? `${HOW_WE_REVIEW_PATH}?from=${encodeURIComponent(link.href)}` : HOW_WE_REVIEW_PATH;
}
