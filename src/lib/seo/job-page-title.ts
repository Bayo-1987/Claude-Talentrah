import { namesARealPlace } from "@/lib/jobs/extract-jd";

/**
 * The job page <title>: "<Role> at <Company> — <City or Remote> | Talentrah", about JOB_TITLE_MAX (65) characters. S12 (h).
 *
 * WHY THE SHAPE. The old title, "<Role> — <Company> — Talentrah", was the same string for every posting of one role at one
 * company whatever the city (a Workable board lists one requisition per city), and long ones were cut by Google in the
 * middle of the company name. Naming the place makes per-city postings distinct; "at" reads as a sentence in a results list.
 *
 * THE POLICY (founder, 2026-10-01): THE COMPANY IS NEVER DROPPED. "Product Manager at Moniepoint" is what people search for;
 * length is cosmetic while duplicate titles are not. A too-long title is trimmed in this order and no further:
 *   1. the " | Talentrah" suffix;
 *   2. the place is the CITY or "Remote" — a remote role stating a country is plain "Remote" at first;
 *   3. the ROLE, at a word boundary (the ellipsis follows a whole word, never half of one), down to a floor of
 *      MIN_ROLE_ROOM characters. If that still does not fit, the title is allowed to run long.
 *
 * DUPLICATES are removed afterwards, and only where they remain. Step 2 would make "Head of Engineering, Supply Chain at
 * Moniepoint — Remote" the title of every one of that role's per-applicant-country postings, so the caller passes the
 * company's OTHER postings (`siblings`) and a posting whose title equals a sibling's gets its country in: "— Remote,
 * Poland", "— Kinshasa, Democratic Republic of the Congo" (suffix dropped if needed, the role never shortened: shortening it
 * would rebuild the collisions). Postings that collide with nothing keep the short place. Two
 * postings that are the same in every respect still collide, and always will: nothing in a title can separate them (that is
 * what superseding duplicates, migration 0202, is for).
 *
 * THE PLACE. The first segment of the first entry: "Cape Town, Western Cape, South Africa" -> Cape Town, "Lagos, Nigeria;
 * Abuja, Nigeria" -> Lagos, "Ghana" -> Ghana. A trailing ISO code is dropped ("Cameroon (CM)" -> Cameroon) and a template
 * placeholder ("City, Country") is no place. A remote role is "Remote". Nothing is invented for a role with no location.
 */
export const JOB_TITLE_MAX = 65;
const SUFFIX = " | Talentrah";
/** The role is never shortened below this many characters; past it the title runs long instead. */
const MIN_ROLE_ROOM = 24;
/** A single "word" longer than this is garbage data and is cut, so a title cannot be unbounded. */
const MAX_WORD = 80;

export interface JobTitleSource {
  title: string;
  company_name: string;
  location: string | null;
  work_type: string | null;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const stripIsoCode = (token: string) => token.replace(/\s*\([A-Z]{2}\)$/, "").trim();

interface Places {
  /** "Remote" or the city; null when the posting names no place. */
  short: string | null;
  /** "Remote, Poland" / "Kinshasa, Democratic Republic of the Congo" where there is exactly one country to add; else the same as `short`. */
  full: string | null;
}

function placesFor(job: JobTitleSource): Places {
  const location = tidy(job.location ?? "");
  if (!namesARealPlace(location)) return { short: null, full: null };
  const entries = location.split(";").map((e) => e.trim()).filter(Boolean);
  const tokens = entries[0]!.split(",").map((s) => s.trim()).filter(Boolean);
  const remoteLed = tokens[0]?.toLowerCase() === "remote";
  if (job.work_type === "remote" || remoteLed) {
    // one entry naming one country: the applicant country is the last token ("Remote, Poland", "Remote, Lagos, Nigeria"), or
    // the location itself when a remote-typed posting stores a place instead ("Lagos, Lagos, Nigeria", "Nigeria")
    const named = remoteLed ? tokens.slice(1) : tokens;
    const country = entries.length === 1 && named.length >= 1 ? stripIsoCode(named[named.length - 1]!) : null;
    return { short: "Remote", full: country ? `Remote, ${country}` : "Remote" };
  }
  const city = stripIsoCode(tokens[0] ?? "");
  if (!city) return { short: null, full: null };
  const country = tokens.length >= 2 ? stripIsoCode(tokens[tokens.length - 1]!) : "";
  return { short: city, full: country && country.toLowerCase() !== city.toLowerCase() ? `${city}, ${country}` : city };
}

/** `role` cut after a WHOLE word so it fits `room` characters including a trailing ellipsis; at least one word is kept. */
function shrinkRole(role: string, room: number): string {
  if (role.length <= room) return role;
  const words = role.split(" ").map((w) => (w.length > MAX_WORD ? w.slice(0, MAX_WORD) : w));
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = length + (kept.length ? 1 : 0) + word.length;
    if (kept.length > 0 && next + 1 > room) break;
    kept.push(word);
    length = next;
  }
  return `${kept.join(" ").replace(/[\s,;:/&-]+$/, "")}…`;
}

function titleFor(role: string, company: string, place: string | null, shrink = true): string {
  const placePart = place ? ` — ${place}` : "";
  const full = `${role} at ${company}${placePart}${SUFFIX}`;
  if (full.length <= JOB_TITLE_MAX) return full;
  const noSuffix = `${role} at ${company}${placePart}`;
  if (noSuffix.length <= JOB_TITLE_MAX) return noSuffix;
  if (!shrink) return noSuffix;
  const tail = ` at ${company}${placePart}`;
  return `${shrinkRole(role, Math.max(JOB_TITLE_MAX - tail.length, MIN_ROLE_ROOM))}${tail}`;
}

function baseTitle(job: JobTitleSource): string {
  return titleFor(tidy(job.title), tidy(job.company_name), placesFor(job).short);
}

/**
 * `siblings` are the company's other postings (the caller's one query); only those whose title would be IDENTICAL to this
 * one's short title cause the country to be added.
 */
export function buildJobPageTitle(job: JobTitleSource, siblings: readonly JobTitleSource[] = []): string {
  const base = baseTitle(job);
  const places = placesFor(job);
  const collides = siblings.some((s) => s !== job && baseTitle(s) === base);
  // the country-bearing form is never shortened further: shortening the role would rebuild the very collisions it separates
  return collides ? titleFor(tidy(job.title), tidy(job.company_name), places.full, false) : base;
}
