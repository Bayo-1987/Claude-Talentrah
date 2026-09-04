/**
 * deriveCountry and friends (src/lib/jobs/country.ts) — Stage 12's country
 * derivation. The load-bearing case: all 18 open `workable-nigeria`
 * postings carry `location = "Remote"` and nothing else (verified live,
 * 2026-09-04) — a naive text-only filter would exclude every one of them.
 */
import { describe, expect, it } from "vitest";
import {
  deriveCountry,
  isTrackedCountry,
  defaultCountryForProfile,
  countryOrFilter,
  countryFromSlug,
  COUNTRY_LANDING_SLUG,
  TRACKED_COUNTRIES,
} from "@/lib/jobs/country";

function job(location: string | null, externalSource: string | null = null) {
  return { location, external_source: externalSource };
}

describe("deriveCountry", () => {
  it(
    "SABOTAGE-PROOF TARGET: a blind workable-nigeria posting still derives Nigeria " +
      "via the source fallback",
    () => {
      expect(deriveCountry(job("Remote", "schema-org:workable-nigeria"))).toBe("Nigeria");
    },
  );

  it("a literal country name in the location wins even without a source fallback", () => {
    expect(deriveCountry(job("Lagos, Nigeria", null))).toBe("Nigeria");
    expect(deriveCountry(job("Accra, Greater Accra Region, Ghana", null))).toBe("Ghana");
    expect(deriveCountry(job("Nairobi, Nairobi County, Kenya", null))).toBe("Kenya");
    expect(deriveCountry(job("Cape Town, Western Cape, South Africa", null))).toBe("South Africa");
  });

  it(
    "SABOTAGE-PROOF TARGET: the source fallback does NOT apply to a multi-country " +
      "employer board — a blind Moniepoint/Wave row must never be guessed",
    () => {
      // "greenhouse" is the bare discriminator these boards share — not a
      // key in SOURCE_COUNTRY_FALLBACK, which only lists single-country
      // schema-org boards.
      expect(deriveCountry(job("Remote", "greenhouse"))).toBe("Unavailable");
      expect(deriveCountry(job("OpCo", "greenhouse"))).toBe("Unavailable");
    },
  );

  it("a real but untracked place is 'Other', never conflated with 'Unavailable'", () => {
    expect(deriveCountry(job("Abidjan, Côte d'Ivoire", "greenhouse"))).toBe("Other");
    expect(deriveCountry(job("Remote, Spain", "greenhouse"))).toBe("Other");
  });

  it("no location and no source fallback is 'Unavailable'", () => {
    expect(deriveCountry(job(null, null))).toBe("Unavailable");
    expect(deriveCountry(job("", null))).toBe("Unavailable");
  });

  it("recognises the other blind-jargon values actually observed live (Wave's 'OpCo')", () => {
    expect(deriveCountry(job("OpCo; Remote", "greenhouse"))).toBe("Unavailable");
  });
});

describe("isTrackedCountry / defaultCountryForProfile", () => {
  it("accepts exactly the four tracked countries", () => {
    for (const c of TRACKED_COUNTRIES) expect(isTrackedCountry(c)).toBe(true);
    expect(isTrackedCountry("Other")).toBe(false);
    expect(isTrackedCountry("United States")).toBe(false);
    expect(isTrackedCountry(undefined)).toBe(false);
    expect(isTrackedCountry(null)).toBe(false);
  });

  it(
    "SABOTAGE-PROOF TARGET: 'Other' and a diaspora country never produce a guessed default",
    () => {
      expect(defaultCountryForProfile("Other")).toBeUndefined();
      expect(defaultCountryForProfile("United Kingdom")).toBeUndefined();
      expect(defaultCountryForProfile("United States")).toBeUndefined();
      expect(defaultCountryForProfile("Canada")).toBeUndefined();
      expect(defaultCountryForProfile(null)).toBeUndefined();
      expect(defaultCountryForProfile(undefined)).toBeUndefined();
    },
  );

  it("a tracked country on the profile becomes the default", () => {
    expect(defaultCountryForProfile("Nigeria")).toBe("Nigeria");
  });
});

describe("countryOrFilter / countryFromSlug", () => {
  it("builds an .or() fragment covering both the name pattern and the source fallback", () => {
    const filter = countryOrFilter("Nigeria");
    expect(filter).toContain("location.ilike.%Nigeria%");
    expect(filter).toContain("external_source.eq.schema-org:workable-nigeria");
  });

  it("round-trips every tracked country through its landing slug", () => {
    for (const c of TRACKED_COUNTRIES) {
      expect(countryFromSlug(COUNTRY_LANDING_SLUG[c])).toBe(c);
    }
    expect(countryFromSlug("not-a-real-slug")).toBeUndefined();
  });
});
