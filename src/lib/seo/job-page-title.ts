import { namesARealPlace } from "@/lib/jobs/extract-jd";

/**
 * The job page <title>: "<Role> at <Company> — <City or Remote> | Talentrah", kept to JOB_TITLE_MAX (65) characters.
 *
 * WHY THE SHAPE. The old title, "<Role> — <Company> — Talentrah", was the same string for every posting of one role at one
 * company whatever the city (a Workable board lists one requisition per city), and long ones were cut by Google in the
 * middle of the company name. Naming the place makes per-city postings distinct; "at" reads as a sentence in a results list.
 *
 * WHAT GOES FIRST WHEN IT IS TOO LONG, in this order, because each step keeps more of what tells two titles apart:
 *   1. the " | Talentrah" suffix — the brand is the least informative part of a result;
 *   2. " at <Company>" — NOT the role. Measured on the live board (S12), one employer lists a role once per applicant country
 *      and several roles share their first 25 characters ("Head of Engineering, ..."); a title that shortens the role makes
 *      all of those one string, while the company is the part every sibling shares, so it distinguishes nothing. The
 *      company stays in the page's H1, description and structured data. (Policy, not accident: the alternative keeps the
 *      company and ellipsizes the role, at the price of duplicate titles for those clusters.)
 *   3. the ROLE is shortened (at a word boundary, with an ellipsis), keeping the place;
 *   4. the place, only if even a shortened role cannot fit beside it;
 *   5. a hard cut of the role, as the last resort.
 *
 * THE PLACE is a city, or "Remote". A remote role stating ONE country says which ("Remote, Poland"): measured on the live
 * board, one employer lists the same role once per applicant country, and "Remote" alone would make all of them one title.
 * A remote role listing several countries, or none, says "Remote" (the countries are in the page and the structured data).
 * Anything else is the first segment of the first place: "Cape Town, Western Cape, South Africa" -> Cape Town,
 * "Lagos, Nigeria; Abuja, Nigeria" -> Lagos, "Ghana" -> Ghana. A trailing ISO code is dropped ("Cameroon (CM)" -> Cameroon)
 * and a template placeholder ("City, Country") is no place at all. Nothing is invented for a role with no location.
 */
export const JOB_TITLE_MAX = 65;
const SUFFIX = " | Talentrah";
/** Below this many characters of role (including the ellipsis) a shortened role says nothing; step 3 takes over. */
const MIN_ROLE_ROOM = 12;

export interface JobTitleSource {
  title: string;
  company_name: string;
  location: string | null;
  work_type: string | null;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

function placeFor(job: JobTitleSource): string | null {
  const location = tidy(job.location ?? "");
  if (!namesARealPlace(location)) return null;
  const entries = location.split(";").map((e) => e.trim()).filter(Boolean);
  const tokens = entries[0]!.split(",").map((s) => s.trim()).filter(Boolean);
  const remoteLed = tokens[0]?.toLowerCase() === "remote";
  if (job.work_type === "remote" || remoteLed) {
    // "Remote, Poland" / "Remote, Lagos, Nigeria" (one entry): the applicant country is the last token.
    if (entries.length === 1 && remoteLed && tokens.length >= 2) return `Remote, ${stripIsoCode(tokens[tokens.length - 1]!)}`;
    return "Remote";
  }
  const place = stripIsoCode(tokens[0] ?? "");
  return place || null;
}

const stripIsoCode = (token: string) => token.replace(/\s*\([A-Z]{2}\)$/, "").trim();

/** `role` cut at a word boundary to fit `room` characters including a trailing ellipsis; a single over-long word is hard cut. */
function shrinkRole(role: string, room: number): string {
  const limit = room - 1;
  if (role.length <= room) return role;
  const cut = role.slice(0, limit + 1);
  const atWord = cut.lastIndexOf(" ");
  const kept = atWord >= 4 ? cut.slice(0, atWord) : role.slice(0, limit);
  return `${kept.replace(/[\s,;:/&-]+$/, "")}…`;
}

export function buildJobPageTitle(job: JobTitleSource): string {
  const role = tidy(job.title);
  const company = tidy(job.company_name);
  const place = placeFor(job);
  const placePart = place ? ` — ${place}` : "";

  const full = `${role} at ${company}${placePart}${SUFFIX}`;
  if (full.length <= JOB_TITLE_MAX) return full;

  const noSuffix = `${role} at ${company}${placePart}`;
  if (noSuffix.length <= JOB_TITLE_MAX) return noSuffix;

  const noCompany = `${role}${placePart}`;
  if (noCompany.length <= JOB_TITLE_MAX) return noCompany;

  if (JOB_TITLE_MAX - placePart.length >= MIN_ROLE_ROOM) return `${shrinkRole(role, JOB_TITLE_MAX - placePart.length)}${placePart}`;

  return shrinkRole(role, JOB_TITLE_MAX);
}
