/**
 * Country derivation for job postings — Stage 12.
 *
 * WHY THIS EXISTS. profiles.country is collected at signup and, before this,
 * used for nothing on the jobs feed — a Lagos user's Recommended and Most
 * Recent tabs showed Dakar/KwaZulu-Natal/East-Africa-travel roles with no
 * signal that anything nearby existed. Defaulting the feed to a user's own
 * country needs a real "which country is THIS posting" answer, and the naive
 * one — search `location` for a country name — silently breaks on exactly the
 * source scraped specifically for Nigeria: all 18 open `workable-nigeria`
 * postings carry `location = "Remote"` and nothing else (verified live,
 * 2026-09-04). A text filter alone would exclude every one of them.
 *
 * THE FIX, in priority order:
 *   1. A country name literally present in `location` — the closed list
 *      below, not a general city/place gazetteer (dedup.ts's
 *      canonicalLocationToken rejects that for a different, harder problem —
 *      collapsing arbitrary location STRINGS for dedup; this only has to
 *      recognise a small, closed set of COUNTRY names actually seen across
 *      the configured sources in sources.config.ts).
 *   2. If blind, the SOURCE's own declared country — valid ONLY for a
 *      schema-org board scraped from a single-country search URL
 *      (`workable-nigeria`, `-ghana`, `-kenya`, `-south-africa`). NOT valid
 *      for a multi-country employer board (Moniepoint, Wave, Jumia, Apollo
 *      Agriculture) — a blind row there could be any country that employer
 *      operates in, so guessing would be worse than saying nothing.
 *   3. Otherwise: a real, non-blind location that just doesn't name one of
 *      the four tracked countries ("Other" — Abidjan, Warsaw, Bangalore...),
 *      or no place signal at all ("Unavailable" — bare "Remote", "OpCo").
 *      Never collapsed into one bucket: "Other" is a known place we simply
 *      don't filter on; "Unavailable" is a genuine unknown. Conflating them
 *      was tried first and reported as one "Unknown" bucket of 108 — see the
 *      audit in the PR description for why that number was misleading.
 *
 * Audited against production 2026-09-04 (open, posted within the 30-day
 * floor): Nigeria 56, South Africa 17, Kenya 17, Ghana 7, Other 100,
 * Unavailable 8 (of 205 total). The four tracked countries are exactly
 * the four home markets Nigeria, Ghana, Kenya and South Africa, which are four entries of src/lib/auth/schemas.ts'
 * signup country list (every ISO country); a profile in any other country gets no feed filter.
 */
import type { Tables } from "@/lib/supabase/types";

export const TRACKED_COUNTRIES = ["Nigeria", "Ghana", "Kenya", "South Africa"] as const;
export type TrackedCountry = (typeof TRACKED_COUNTRIES)[number];

export type DerivedCountry = TrackedCountry | "Other" | "Unavailable";

export function isTrackedCountry(value: string | undefined | null): value is TrackedCountry {
  return !!value && (TRACKED_COUNTRIES as readonly string[]).includes(value);
}

/** Case-insensitive, whole-word-ish literal match — no stemming, no gazetteer. */
const COUNTRY_NAME_PATTERNS: Record<TrackedCountry, RegExp> = {
  Nigeria: /nigeria/i,
  Ghana: /ghana/i,
  Kenya: /kenya/i,
  "South Africa": /south africa/i,
};

/**
 * schema-org sources scraped from a single-country search URL
 * (src/lib/jobs/sources.config.ts) — the ONLY sources where a blind location
 * can be safely attributed to a country. Keep this in sync with
 * sources.config.ts by hand; it is deliberately small and reviewed the same
 * way a new source itself is, not derived automatically.
 */
export const SOURCE_COUNTRY_FALLBACK: Partial<Record<string, TrackedCountry>> = {
  "schema-org:workable-nigeria": "Nigeria",
  // Nigeria city pages (sources.config.ts) — same single-country search URL
  // shape as workable-nigeria itself, so the same fallback rule applies: a
  // blind row from one of these is Nigeria, never a guess, because the
  // source is scoped to a Nigerian city by construction, not by inference.
  "schema-org:workable-lagos": "Nigeria",
  "schema-org:workable-abuja": "Nigeria",
  "schema-org:workable-ibadan": "Nigeria",
  "schema-org:workable-port-harcourt": "Nigeria",
  "schema-org:workable-ghana": "Ghana",
  "schema-org:workable-kenya": "Kenya",
  "schema-org:workable-south-africa": "South Africa",
};

/**
 * Real location strings carrying no place signal at all — jargon or a bare
 * "remote", as opposed to a real (if untracked) place name. Observed live:
 * Wave's "OpCo" and "OpCo; Remote", and a bare "Remote" across several
 * sources. Anything else non-empty is treated as a real, if untracked, place
 * ("Other"), never guessed at further.
 */
const BLIND_LOCATION_VALUES = new Set(["remote", "opco", "opco; remote", "remote; opco"]);

function isBlindLocation(location: string | null): boolean {
  if (!location) return true;
  return BLIND_LOCATION_VALUES.has(location.trim().toLowerCase());
}

type DeriveCountryInput = Pick<Tables<"job_postings">, "location" | "external_source">;

export function deriveCountry(job: DeriveCountryInput): DerivedCountry {
  const { location, external_source: externalSource } = job;

  if (location) {
    for (const country of TRACKED_COUNTRIES) {
      if (COUNTRY_NAME_PATTERNS[country].test(location)) return country;
    }
  }

  const fallback = externalSource ? SOURCE_COUNTRY_FALLBACK[externalSource] : undefined;
  if (fallback) return fallback;

  return isBlindLocation(location) ? "Unavailable" : "Other";
}

/**
 * Below this many real matches, the country filter must not narrow the feed
 * to near-nothing — see jobs/page.tsx's fallback behaviour. Reuses
 * LANDING_PAGE_MIN_ENTRIES's value (5) for the same reason a page below that
 * line is doorway-thin: a "filtered" view with fewer results than this reads
 * as broken, not focused.
 */
export const COUNTRY_THIN_THRESHOLD = 5;

export const COUNTRY_LANDING_SLUG: Record<TrackedCountry, string> = {
  Nigeria: "nigeria",
  Ghana: "ghana",
  Kenya: "kenya",
  "South Africa": "south-africa",
};

export function countryFromSlug(slug: string): TrackedCountry | undefined {
  return TRACKED_COUNTRIES.find((c) => COUNTRY_LANDING_SLUG[c] === slug);
}

/**
 * A country's own SOURCE_COUNTRY_FALLBACK keys, reversed — for building the
 * `.or()` filter public landing pages need (they query the database
 * directly rather than filtering an already-fetched array; see
 * jobs/page.tsx's own header for why the authenticated feed can do the
 * latter and these pages cannot).
 *
 * ALL matches, not just the first — Nigeria alone now has five fallback
 * sources (workable-nigeria plus four city pages), and a `.find()` here
 * would silently only ever filter on whichever one happens to be first in
 * SOURCE_COUNTRY_FALLBACK's own key order, missing blind rows from every
 * other one. That would be exactly the kind of independent drift this
 * function's own header says can't happen between the JS and SQL paths —
 * deriveCountry already checks every fallback source for a country via a
 * single object lookup; this has to do the same via every matching key.
 */
function fallbackSourcesFor(country: TrackedCountry): string[] {
  return Object.entries(SOURCE_COUNTRY_FALLBACK)
    .filter(([, c]) => c === country)
    .map(([source]) => source);
}

/**
 * Supabase `.or()` fragment matching deriveCountry's own logic at the SQL
 * level, for the public/unauthenticated landing pages
 * (loadCountryRemoteJobs) that need a real COUNT rather than an in-memory
 * partition of an already-fetched page. Kept as one function, built from the
 * SAME constants deriveCountry uses, so the two can't independently drift on
 * which countries/sources/patterns are recognised — only the execution
 * context (JS vs SQL) differs.
 */
export function countryOrFilter(country: TrackedCountry): string {
  const clauses = [`location.ilike.%${country}%`];
  for (const fallbackSource of fallbackSourcesFor(country)) {
    clauses.push(`external_source.eq.${fallbackSource}`);
  }
  return clauses.join(",");
}

/**
 * Which country a /jobs request applies: ONLY the one the URL names. There is no default: not from the profile, a cookie, a stored value, the locale, the IP or a
 * hard-coded "NG". The param absent means every country. (The feed used to default to the profile's country when the param was absent, which made "remove the chip"
 * impossible to keep: the chip came back on the next link that did not repeat the param. Talentrah serves more than four home markets; a country is something a
 * person chooses.)
 *
 * `chosen` is what the URL named, whatever the tab; `country` is what the tab APPLIES. They differ on Saved, which is the person's own set and has no country concept
 * (send-496): there `country` is undefined but `chosen` survives, so the tab links still carry the choice back to the other tabs.
 *
 * `country=all` is still understood, as no country, because links written before this change exist (bookmarks, notifications already sent). It is never written again.
 * `countryState` is the existing instrumentation dimension (country_default_events.country_state): "kept" a country is applied, "cleared" an old country=all link,
 * "none" nothing is applied.
 */
export function resolveCountryParam(
  param: string | undefined | null,
  tab: string,
): { country: TrackedCountry | undefined; chosen: TrackedCountry | undefined; countryState: "kept" | "cleared" | "none" } {
  const chosen = isTrackedCountry(param) ? param : undefined;
  if (tab === "saved") return { country: undefined, chosen, countryState: "none" };
  if (chosen) return { country: chosen, chosen, countryState: "kept" };
  return { country: undefined, chosen: undefined, countryState: param === "all" ? "cleared" : "none" };
}

/**
 * profiles.country mapped to an optional VISIBLE SUGGESTION ("Show roles in Nigeria", a link the person may click), never to a filter. Only a tracked country (the four
 * boards with real inventory) is suggested; "Other" and every other country get nothing. Nothing is suggested once a country is chosen or on the Saved tab.
 */
export function countrySuggestion(
  profileCountry: string | null | undefined,
  chosen: TrackedCountry | undefined,
  tab: string,
): TrackedCountry | undefined {
  if (chosen || tab === "saved") return undefined;
  return defaultCountryForProfile(profileCountry);
}

/**
 * profiles.country's own value ("Nigeria" | "Ghana" | "Kenya" | "South Africa" | "Other" | any other country on the signup list — see SIGNUP_COUNTRIES/
 * DIASPORA_COUNTRIES in src/lib/auth/schemas.ts) mapped to the one of the four tracked boards it names, or undefined. It decides nothing about the feed: only
 * countrySuggestion above uses it, to offer a link.
 */
export function defaultCountryForProfile(profileCountry: string | null | undefined): TrackedCountry | undefined {
  return isTrackedCountry(profileCountry) ? profileCountry : undefined;
}
