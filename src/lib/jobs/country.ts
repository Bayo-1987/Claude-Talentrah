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
 * HOME_COUNTRIES minus "Other" (src/lib/auth/schemas.ts) — the same four
 * profiles.country already offers at signup.
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
 * A country's own SOURCE_COUNTRY_FALLBACK key, reversed — for building the
 * `.or()` filter public landing pages need (they query the database
 * directly rather than filtering an already-fetched array; see
 * jobs/page.tsx's own header for why the authenticated feed can do the
 * latter and these pages cannot).
 */
function fallbackSourceFor(country: TrackedCountry): string | undefined {
  return Object.entries(SOURCE_COUNTRY_FALLBACK).find(([, c]) => c === country)?.[0];
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
  const fallbackSource = fallbackSourceFor(country);
  if (fallbackSource) clauses.push(`external_source.eq.${fallbackSource}`);
  return clauses.join(",");
}

/**
 * profiles.country's own value ("Nigeria" | "Ghana" | "Kenya" | "South
 * Africa" | "Other" | a diaspora country — see HOME_COUNTRIES/
 * DIASPORA_COUNTRIES in src/lib/auth/schemas.ts) mapped to a default feed
 * filter. Deliberately returns undefined for "Other" and every diaspora
 * country: this product's country filter targets the four boards it actually
 * has meaningful inventory for, and defaulting a US/UK/Canada-based user (or
 * one who picked "Other") into one of those four would be a guess with
 * nothing behind it — no filter is the honest default there, same as a user
 * with no profile.country set at all.
 */
export function defaultCountryForProfile(profileCountry: string | null | undefined): TrackedCountry | undefined {
  return isTrackedCountry(profileCountry) ? profileCountry : undefined;
}
