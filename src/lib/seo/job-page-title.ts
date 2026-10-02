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
 *   3. the ROLE, at a word boundary (the ellipsis follows a whole word, never half of one), until the title fits
 *      JOB_TITLE_CAP (70), down to a floor of MIN_ROLE_ROOM characters. Only if the company plus that minimal role and the
 *      place still do not fit does the title exceed 70 (`overflowsBecauseOfCompany`; the page never drops the company).
 *
 * DUPLICATES are removed afterwards, and only where they remain. Step 2 would make "Head of Engineering, Supply Chain at
 * Moniepoint — Remote" the title of every one of that role's per-applicant-country postings, so the caller passes the
 * company's OTHER postings (`siblings`) and a posting whose title equals a sibling's gets its country in: "— Remote,
 * Poland", "— Kinshasa, Democratic Republic of the Congo" (suffix dropped, the role shortened to the cap like any other title).
 * Postings that collide with nothing keep the short place. Two
 * postings that are the same in every respect still collide, and always will: nothing in a title can separate them (that is
 * what superseding duplicates, migration 0202, is for).
 *
 * THE PLACE. The first segment of the first entry: "Cape Town, Western Cape, South Africa" -> Cape Town, "Lagos, Nigeria;
 * Abuja, Nigeria" -> Lagos, "Ghana" -> Ghana. A trailing ISO code is dropped ("Cameroon (CM)" -> Cameroon) and a template
 * placeholder ("City, Country") is no place. A remote role is "Remote". Nothing is invented for a role with no location.
 */
export const JOB_TITLE_MAX = 65;
/**
 * The hard cap (founder, second ruling on 2026-10-01: a first version let 40 titles run past 70 and one reach 100). The
 * ONLY way a title exceeds it is when the company plus a minimal role cannot fit — `overflowsBecauseOfCompany`, a counted
 * exception class — because the company is never dropped.
 */
export const JOB_TITLE_CAP = 70;
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

/** How the role is shortened: from the end (keep the opening words), or from the middle (keep the opening AND closing words). */
type Cut = "head" | "middle";

/**
 * `role` shortened to fit `room` characters. "head" keeps the first whole words and ends with an ellipsis; "middle" keeps
 * the first whole words AND the last whole words with the ellipsis between them, so roles that differ only at the end
 * ("... - Kruger Specialist" / "... - Madikwe Specialist") stay different.
 */
function cutRole(role: string, room: number, cut: Cut): string {
  if (cut === "head" || role.length <= room) return shrinkRole(role, room);
  const words = role.split(" ").map((w) => (w.length > MAX_WORD ? w.slice(0, MAX_WORD) : w));
  if (words.length < 3) return shrinkRole(role, room);
  // closing words first (at most 60% of the room), then opening words in what is left
  const tail: string[] = [];
  let tailLength = 0;
  for (let i = words.length - 1; i > 0; i -= 1) {
    const next = tailLength + words[i]!.length + 1;
    if (next > room * 0.6 && tail.length > 0) break;
    tail.unshift(words[i]!);
    tailLength = next;
  }
  const headRoom = room - tailLength - 1; // the ellipsis
  const head: string[] = [];
  let headLength = 0;
  for (let i = 0; i < words.length - tail.length; i += 1) {
    const next = headLength + (head.length ? 1 : 0) + words[i]!.length;
    if (head.length > 0 && next > headRoom) break;
    head.push(words[i]!);
    headLength = next;
  }
  if (head.length + tail.length >= words.length) return role;
  return `${head.join(" ").replace(/[\s,;:/&-]+$/, "")}… ${tail.join(" ")}`;
}

/** Stages of one posting's title, from the shortest-lived form to the last resort. */
function titleFor(role: string, company: string, place: string | null, cut: Cut = "head"): string {
  const placePart = place ? ` — ${place}` : "";
  const full = `${role} at ${company}${placePart}${SUFFIX}`;
  if (full.length <= JOB_TITLE_MAX) return full;
  const noSuffix = `${role} at ${company}${placePart}`;
  if (noSuffix.length <= JOB_TITLE_CAP) return noSuffix;
  const tail = ` at ${company}${placePart}`;
  return `${cutRole(role, Math.max(JOB_TITLE_CAP - tail.length, MIN_ROLE_ROOM), cut)}${tail}`;
}

function baseTitle(job: JobTitleSource): string {
  return titleFor(tidy(job.title), tidy(job.company_name), placesFor(job).short);
}

/**
 * The forms a posting's title can take, in the order they are tried: [0] the short place, role cut from the end; [1] the
 * country-bearing place, same cut; [2] the short place with the role cut in the MIDDLE (its closing words are what tell
 * "… Kruger Specialist" from "… Madikwe Specialist"); [3] the country-bearing place with the middle cut; [4] nothing cut —
 * the only form that can exceed the cap, used only for a collision no cut can separate.
 */
function variants(job: JobTitleSource): string[] {
  const role = tidy(job.title);
  const company = tidy(job.company_name);
  const places = placesFor(job);
  const unshortened = `${role} at ${company}${places.full ? ` — ${places.full}` : ""}`;
  return [
    baseTitle(job),
    titleFor(role, company, places.full, "head"),
    titleFor(role, company, places.short, "middle"),
    titleFor(role, company, places.full, "middle"),
    unshortened,
  ];
}

/**
 * `siblings` are the company's other postings (the caller's one query). The first form that no sibling shares is used, so
 * the country is added, and the role cut differently, ONLY where a collision demands it.
 */
export function buildJobPageTitle(job: JobTitleSource, siblings: readonly JobTitleSource[] = []): string {
  const mine = variants(job);
  const others = siblings.filter((s) => s !== job).map(variants);
  for (let k = 0; k < mine.length; k += 1) {
    if (!others.some((o) => o[k] === mine[k])) return mine[k]!;
  }
  return mine[mine.length - 1]!; // identical in every respect to a sibling: nothing a title can add
}

/**
 * True when this posting's title must exceed JOB_TITLE_CAP because " at <Company>" plus the place plus a minimal role
 * (MIN_ROLE_ROOM characters, with its ellipsis) cannot fit in 70 — the one class the cap does not cover, because the company
 * is never dropped. Used by the tests and to count the class on real data.
 */
export function overflowsBecauseOfCompany(job: JobTitleSource, siblings: readonly JobTitleSource[] = []): boolean {
  const title = buildJobPageTitle(job, siblings);
  if (title.length <= JOB_TITLE_CAP) return false;
  const company = tidy(job.company_name);
  const places = placesFor(job);
  // the place the title actually used: the country-bearing form only when a sibling collides
  const used = title.includes(` — ${places.full}`) && places.full !== places.short ? places.full : places.short;
  const tail = ` at ${company}${used ? ` — ${used}` : ""}`;
  return tail.length + MIN_ROLE_ROOM > JOB_TITLE_CAP;
}
