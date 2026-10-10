import { COUNTRY_DISPLAY_NAMES, compareCountryNames } from "@/lib/jobs/countries";

/*
 * THE ONE SIGN-UP COUNTRY LIST, in a module with no zod. Moved out of schemas.ts (which re-exports every name here, so no importer changes) because
 * client components render this list, and a client component must not reach zod (tests/perf/client-components-zod-free.test.ts).
 */

/** The home market, listed first. */
export const HOME_COUNTRY = "Nigeria";

/** The diaspora markets (a natural hard-currency audience), listed straight after the home market. */
export const DIASPORA_COUNTRIES = ["United Kingdom", "United States", "Canada"] as const;

/**
 * For an account whose country is not on the list, and for every account that stored "Other" before the list was complete:
 * it stays valid and is listed LAST, so an existing profile still saves.
 */
export const OTHER_COUNTRY = "Other";

/**
 * What signup and settings offer: the full ISO 3166-1 list (plus Kosovo) from src/lib/jobs/countries.ts, Nigeria first, then the
 * diaspora markets, then everything else A to Z, then "Other". The names the old eight-country list used are all in it,
 * spelled the same, so every stored profiles.country value still validates.
 *
 * profiles.country is read by exactly three things, none of which a new country can send somewhere wrong (pinned for every
 * entry in tests/auth/signup-countries.test.tsx): the billing region (Nigeria vs outside it; billing is naira for everyone),
 * the feed default (only the four tracked countries filter; everything else is "no filter"), and an employer's default salary
 * currency (EU members get EUR, the seven mapped countries their own, every other country USD).
 */
const featured: readonly string[] = [HOME_COUNTRY, ...DIASPORA_COUNTRIES];
export const SIGNUP_COUNTRIES: readonly string[] = [
  ...featured,
  ...COUNTRY_DISPLAY_NAMES.filter((name) => !featured.includes(name)).sort(compareCountryNames),
  OTHER_COUNTRY,
];

const SIGNUP_COUNTRY_SET: ReadonlySet<string> = new Set(SIGNUP_COUNTRIES);
/** Exactly one of the listed names (case-sensitive, no trimming: it is what the select submits). */
export function isSignupCountry(value: string): boolean {
  return SIGNUP_COUNTRY_SET.has(value);
}

