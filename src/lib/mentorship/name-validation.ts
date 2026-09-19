/**
 * send-400 — both of production's only two approved mentors displayed an
 * organisation/account name instead of a person's name ("Zimcrest
 * Technologies", "Info Talentrah"), even though each one's own bio is
 * written entirely in first person by a real individual.
 *
 * There is no "display name" field on the mentor application form itself
 * (src/app/(app)/mentorship/apply/application-form.tsx) to reject outright
 * — a mentor's public name always comes from `profiles.first_name`/
 * `last_name` (set at ordinary account signup, read publicly via
 * `mentor_public_names()`, migration 0167), never from anything this form
 * collects. And every application already sits in a `status = 'pending'`
 * queue a human admin must approve by hand before it is ever public
 * (`/admin/mentor-review`'s own comment: "APPROVING IS THE WHOLE GRANT" —
 * there is no second gate). So the correctly-scoped fix is not a new reject
 * path on a field that doesn't exist; it's making sure the admin reviewing
 * that queue can't miss the signal that was there all along.
 *
 * This is a HEURISTIC, not a proof, and it stays a manual-review flag rather
 * than a block for exactly that reason: a false positive is possible (e.g.
 * someone whose legal name genuinely contains a word like "Group", or who
 * runs a personal-branded email domain matching their own name). Both real
 * production cases are covered without needing that kind of coincidence:
 * "Zimcrest Technologies" trips the company-word check directly; "Info
 * Talentrah" trips both the own-domain check (its email is
 * info@talentrah.com, not a public provider) and the organisation-name
 * check (it belongs to the "Talentrah Portal" org on the employer side).
 */

const COMPANY_WORD =
  /\b(technologies?|tech|ltd|limited|llc|inc|incorporated|corp|corporation|enterprises?|solutions?|group|company|ventures?|holdings?|portal|services?|consulting|systems?|agency|studio|networks?)\b/i;

// Public/free email providers are excluded from the own-domain check:
// "firstname@gmail.com" tells you nothing about whether the name is real,
// since almost every individual mentor will sign up from one of these.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "protonmail.com",
  "aol.com",
  "live.com",
  "msn.com",
  "yandex.com",
]);

// Word-level, not whole-string substring: "Info Talentrah" and its own org
// "Talentrah Portal" share the word "talentrah" but neither string is a
// substring of the other, so a plain `.includes()` between the two full
// strings would miss exactly the production case this exists to catch.
// Words under 4 characters are dropped to avoid matching on filler
// ("the", "and", "of").
function significantWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

export interface MentorNameCheck {
  suspicious: boolean;
  reason: string | null;
}

const NOT_SUSPICIOUS: MentorNameCheck = { suspicious: false, reason: null };

/**
 * `name` is exactly what `mentor_public_names()` will show publicly.
 * `email` and `orgNames` (the applicant's own organisation name(s), if they
 * are also an employer-side org member) are the two places production's bad
 * names actually came from — see the file header.
 */
export function checkMentorDisplayName(name: string, email: string, orgNames: string[]): MentorNameCheck {
  const trimmedName = name.trim();
  if (!trimmedName) return NOT_SUSPICIOUS;

  if (COMPANY_WORD.test(trimmedName)) {
    return {
      suspicious: true,
      reason:
        'Contains a company-style word (e.g. "Technologies", "Ltd", "Group") rather than reading as a person\'s name.',
    };
  }

  const nameWords = new Set(significantWords(trimmedName));
  const domain = email.toLowerCase().split("@")[1] ?? "";
  const domainLabel = domain.split(".")[0] ?? "";

  if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain) && domainLabel.length >= 4 && nameWords.has(domainLabel)) {
    return {
      suspicious: true,
      reason: `Matches this account's own email domain (${domain}) rather than reading as a person's name.`,
    };
  }

  for (const orgName of orgNames) {
    const shared = significantWords(orgName).find((w) => nameWords.has(w));
    if (shared) {
      return {
        suspicious: true,
        reason: `Shares "${shared}" with the organisation name on file for this account ("${orgName}") rather than reading as a person's name.`,
      };
    }
  }

  return NOT_SUSPICIOUS;
}
