/**
 * What a mentor application (and a later edit of it) must contain, checked on the server (S1-93).
 *
 * The form used to send blanks straight through: every empty field became null, the database allows null for every column, and an application with nothing in it
 * answered "Application submitted". These rules are the server's own; the form only shows what this returns.
 *
 *   required   display name (trimmed, non-empty) · bio (at least 80 characters of text) · at least one role · years of experience (a whole number, 0 to 60)
 *   optional   industries · the price: blank means free or volunteer (a real, permanent option here), but a price that is given must be a positive whole number
 *
 * One rule for both: the same checks run when applying and when editing a saved profile. Only the wording differs: an edit that is refused says it in the words of saving
 * ("before you can save changes"), because a mentor whose profile was saved before these rules existed meets them for the first time there.
 *
 * A field that is not in the submission at all (as opposed to submitted empty) is "not provided": for the two optional fields that means "leave it as it is", so an
 * edit can never blank a saved value by leaving a key out. A required field that is missing is an error, whichever way it is missing.
 */

export const BIO_MIN_CHARS = 80;
export const YEARS_MAX = 60;
/** The price column is a 32-bit integer. */
const PRICE_MAX = 2_147_483_647;

export type ApplicationField = "displayName" | "bio" | "expertiseRoles" | "yearsExperience" | "basePriceNgn";
export type ApplicationFieldErrors = Partial<Record<ApplicationField, string>>;

/** What the person typed, as text, so a form that is refused can show it back instead of going blank. */
export interface ApplicationFormValues {
  displayName: string;
  bio: string;
  expertiseRoles: string;
  expertiseIndustries: string;
  yearsExperience: string;
  basePriceNgn: string;
}

export interface ParsedApplication {
  displayName: string;
  bio: string;
  expertiseRoles: string[];
  /** undefined: not in the submission, leave the saved value alone. */
  expertiseIndustries: string[] | undefined;
  yearsExperience: number;
  /** undefined: not in the submission, leave the saved value alone. null: submitted blank, which means free or volunteer. */
  basePriceNgn: number | null | undefined;
}

export type ApplicationParseResult =
  | { ok: true; value: ParsedApplication }
  | { ok: false; errors: ApplicationFieldErrors; values: ApplicationFormValues };

export function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * How much text a bio holds. The bio is stored as a small bold/italic markdown subset (see MinimalRichEditor), and the marks are not text: a bio made of
 * asterisks is empty. Runs of whitespace count once.
 */
export function bioTextLength(markdown: string): number {
  return markdown
    .replace(/\*+/g, "")
    .replace(/(^|\s)_+|_+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim().length;
}

const text = (formData: FormData, key: string): string | null => {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : null;
};

export type ApplicationMode = "apply" | "edit";

export function parseMentorApplication(formData: FormData, mode: ApplicationMode = "apply"): ApplicationParseResult {
  const ending = mode === "edit" ? "before you can save changes" : "before you can submit your application";
  const raw = (key: keyof ApplicationFormValues) => text(formData, key);
  const values: ApplicationFormValues = {
    displayName: raw("displayName") ?? "",
    bio: raw("bio") ?? "",
    expertiseRoles: raw("expertiseRoles") ?? "",
    expertiseIndustries: raw("expertiseIndustries") ?? "",
    yearsExperience: raw("yearsExperience") ?? "",
    basePriceNgn: raw("basePriceNgn") ?? "",
  };
  const errors: ApplicationFieldErrors = {};

  const displayName = values.displayName.trim();
  if (!displayName) errors.displayName = mode === "edit" ? `Add the name mentees will see ${ending}.` : "Enter the name mentees will see.";

  const bio = values.bio.trim();
  const bioLength = bioTextLength(bio);
  if (bioLength < BIO_MIN_CHARS) {
    if (mode === "edit") errors.bio = `Your bio needs at least ${BIO_MIN_CHARS} characters ${ending}.${bioLength > 0 ? ` It is ${bioLength} now.` : ""}`;
    else if (bioLength === 0) errors.bio = `Write a bio of at least ${BIO_MIN_CHARS} characters about your experience and who you can help.`;
    else errors.bio = `Your bio is ${bioLength} characters. Write at least ${BIO_MIN_CHARS}, so mentees can tell whether you are the right mentor.`;
  }

  const expertiseRoles = splitTags(values.expertiseRoles);
  if (expertiseRoles.length === 0) errors.expertiseRoles = mode === "edit" ? `Add at least one role you can speak to ${ending}.` : "Add at least one role you can speak to, for example Product Manager.";

  const yearsText = values.yearsExperience.trim();
  const years = /^\d{1,3}$/.test(yearsText) ? Number(yearsText) : NaN;
  if (!(years >= 0 && years <= YEARS_MAX)) errors.yearsExperience = mode === "edit" ? `Add your years of experience, a whole number from 0 to ${YEARS_MAX}, ${ending}.` : `Enter your years of experience as a whole number from 0 to ${YEARS_MAX}.`;

  let basePriceNgn: number | null | undefined;
  const priceRaw = raw("basePriceNgn");
  if (priceRaw !== null) {
    const priceText = priceRaw.trim();
    if (!priceText) {
      basePriceNgn = null;
    } else if (/^\d+$/.test(priceText) && Number(priceText) >= 1 && Number(priceText) <= PRICE_MAX) {
      basePriceNgn = Number(priceText);
    } else {
      errors.basePriceNgn = "Enter the price as a positive whole number of Naira, or leave it blank if you are free or a volunteer.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return {
    ok: true,
    value: {
      displayName,
      bio,
      expertiseRoles,
      expertiseIndustries: raw("expertiseIndustries") === null ? undefined : splitTags(values.expertiseIndustries),
      yearsExperience: years,
      basePriceNgn,
    },
  };
}
