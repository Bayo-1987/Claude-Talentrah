import { countryCodeForLabel } from "@/lib/jobs/countries";
import { SIGNUP_COUNTRIES } from "@/lib/auth/countries";

/** Alpha-2 code -> the sign-up list's own name for it (built from the list itself, so a suggestion can only ever be a listed value). "Other" has no code and is never in it. */
const NAME_BY_CODE: ReadonlyMap<string, string> = new Map(
  SIGNUP_COUNTRIES.flatMap((name) => {
    const code = countryCodeForLabel(name);
    return code ? [[code, name] as const] : [];
  }),
);

/**
 * The country the browser's locale suggests, for prefilling the Google country step, or null.
 *
 * Reads the Accept-Language header (the browser's own ordered list of locales, e.g. "en-NG,en;q=0.9"): the first tag, in the browser's order of preference, that
 * carries a region which names a country ON THE SIGN-UP LIST is the answer. A tag with no region ("en"), an unknown region, the list's "Other" entry or a
 * region that is not a country all give nothing: the step then starts empty rather than guessing. It is only ever a suggestion; nothing is saved until the person
 * presses Continue.
 */
export function countryFromAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((t) => t.tag && t.tag !== "*" && t.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { tag } of tags) {
    const region = tag.split("-").slice(1).find((subtag) => /^[A-Za-z]{2}$/.test(subtag));
    if (!region) continue;
    const name = NAME_BY_CODE.get(region.toUpperCase());
    if (name) return name;
  }
  return null;
}

/** Vercel sets this request header to the two-letter country of the caller's IP. It is absent in local development, in CI and anywhere not behind Vercel; the page then falls back to the browser language. Read in ONE place (the country step page). */
export const COUNTRY_IP_HEADER = "x-vercel-ip-country";

/**
 * The sign-up list's own name for a two-letter country code (the IP country), or null. Accepts lowercase and surrounding space. An unknown or reserved code (XX, T1 for Tor), anything that is not exactly
 * two letters, an empty value and the list's "Other" entry all give null: the step then falls back to the language and, failing that, starts empty. Built on the same code-to-name map as the language path,
 * so a suggestion can only ever be a listed value.
 */
export function countryFromIpCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim();
  if (!trimmed || !/^[A-Za-z]{2}$/.test(trimmed)) return null;
  return NAME_BY_CODE.get(trimmed.toUpperCase()) ?? null;
}

export type CountrySuggestionSource = "ip" | "browser";

/** What to pre-select on the country step and where it came from: the IP country first, then the browser language, else nothing. Only ever a suggestion; nothing is saved until Continue. */
export function suggestCountry(
  ipCountryCode: string | null | undefined,
  acceptLanguage: string | null | undefined,
): { country: string | null; source: CountrySuggestionSource | null } {
  const fromIp = countryFromIpCode(ipCountryCode);
  if (fromIp) return { country: fromIp, source: "ip" };
  const fromLanguage = countryFromAcceptLanguage(acceptLanguage);
  if (fromLanguage) return { country: fromLanguage, source: "browser" };
  return { country: null, source: null };
}
