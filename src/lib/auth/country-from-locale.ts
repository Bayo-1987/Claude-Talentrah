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
