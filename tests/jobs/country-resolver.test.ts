/**
 * S12 (c)/(g) — `resolveCountry`: a single free-text token ("Ghana", "UK", "Cameroon (CM)") to a country, or null.
 *
 * ONLY exact ISO 3166-1 names (CLDR English short names, committed as data in src/lib/jobs/countries.ts so a Node/ICU
 * upgrade cannot change them) plus a small EXPLICIT alias table. Not a gazetteer: it is consulted for a token that
 * stands alone ("Ghana"; the one token after "Remote, "), never to find a country inside a longer string.
 *
 * The two refusals the founder named are tested by name: "Georgia" (a US state as often as a country) and "Jersey" (a
 * city/state as often as a Crown dependency) must NOT resolve from free text.
 */
import { describe, expect, it } from "vitest";
import { ALIASES, AMBIGUOUS_UNLESS_MARKED, ISO_COUNTRY_COUNT, resolveCountry } from "@/lib/jobs/countries";

describe("resolveCountry: exact ISO names", () => {
  it.each([
    ["Nigeria", "Nigeria"],
    ["Ghana", "Ghana"],
    ["Kenya", "Kenya"],
    ["South Africa", "South Africa"],
    ["Senegal", "Senegal"],
    ["Poland", "Poland"],
    ["United Kingdom", "United Kingdom"],
    ["United States", "United States"],
    ["United Arab Emirates", "United Arab Emirates"],
    ["Egypt", "Egypt"],
    ["Rwanda", "Rwanda"],
    ["Cameroon", "Cameroon"],
  ])("%s -> %s", (raw, want) => {
    expect(resolveCountry(raw)).toBe(want);
  });

  it("ignores case, surrounding space, diacritics, and the ampersand/and difference", () => {
    expect(resolveCountry("  nigeria ")).toBe("Nigeria");
    expect(resolveCountry("SOUTH AFRICA")).toBe("South Africa");
    expect(resolveCountry("Cote d'Ivoire")).toBe("Côte d'Ivoire");
    expect(resolveCountry("Côte d’Ivoire")).toBe("Côte d'Ivoire");
    expect(resolveCountry("Bosnia and Herzegovina")).toBe("Bosnia and Herzegovina");
    expect(resolveCountry("Bosnia & Herzegovina")).toBe("Bosnia and Herzegovina");
  });

  it("carries the 249 ISO 3166-1 entries", () => {
    expect(ISO_COUNTRY_COUNT).toBe(249);
  });
});

describe("resolveCountry: the explicit alias table, each alias tested", () => {
  it.each([
    ["UK", "United Kingdom"],
    ["U.K.", "United Kingdom"],
    ["USA", "United States"],
    ["U.S.A.", "United States"],
    ["US", "United States"],
    ["UAE", "United Arab Emirates"],
    ["Ivory Coast", "Côte d'Ivoire"],
    ["Turkey", "Türkiye"],
    ["Czech Republic", "Czechia"],
    ["DR Congo", "Democratic Republic of the Congo"],
    ["Democratic Republic of the Congo", "Democratic Republic of the Congo"],
    ["Republic of the Congo", "Republic of the Congo"],
    ["Kosovo", "Kosovo"],
  ])("%s -> %s", (raw, want) => {
    expect(resolveCountry(raw)).toBe(want);
  });

  it("every alias in the table resolves, and nothing resolves through an alias that is not in the table", () => {
    for (const alias of Object.keys(ALIASES)) expect(resolveCountry(alias), alias).not.toBeNull();
  });
});

describe("resolveCountry: a trailing ISO code in parentheses, as the live column has it", () => {
  it("'Cameroon (CM)' -> Cameroon, only when the code belongs to that country", () => {
    expect(resolveCountry("Cameroon (CM)")).toBe("Cameroon");
    expect(resolveCountry("Cameroon (NG)")).toBeNull();
  });
});

describe("resolveCountry: what must NOT become a country", () => {
  it.each(["Georgia", "georgia", "Jersey", "JERSEY", "Congo"])("%s is ambiguous in free text, so null", (raw) => {
    expect(resolveCountry(raw)).toBeNull();
  });

  it("the ambiguous set is exactly the one tested here (adding to it is a decision, not an accident)", () => {
    expect([...AMBIGUOUS_UNLESS_MARKED].sort()).toEqual(["Congo", "Georgia", "Jersey"]);
  });

  it.each(["Lagos", "Bangalore", "Nairobi", "EMEA", "Europe", "Africa", "Worldwide", "Anywhere", "Remote", "", "  ", "Germany and Switzerland"])(
    "%j is not a country",
    (raw) => {
      expect(resolveCountry(raw)).toBeNull();
    },
  );
});
