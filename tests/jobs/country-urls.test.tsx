/**
 * The pure pieces behind "no country unless the URL carries one": which country a request applies (resolveCountryParam), the tab links (feedTabHref), the Most
 * Recent paging link (recentPageHref) and the helper line (countryNote). No database, no profile, no cookie: these take only what the URL says.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveCountryParam, countrySuggestion } from "@/lib/jobs/country";
import { feedTabHref, recentPageHref } from "@/lib/jobs/feed-href";
import { CountryNote } from "@/components/jobs/country-note";

describe("resolveCountryParam", () => {
  it("no country param means no country filter, whatever else is true of the person", () => {
    // A profile country, a cookie or a stored value cannot reach this function: its inputs are the URL param and the tab.
    const g = globalThis as Record<string, unknown>;
    g.localStorage = { getItem: () => "Nigeria" };
    g.document = { cookie: "country=Nigeria" };
    try {
      for (const tab of ["recommended", "external", "recent", "saved"]) {
        expect(resolveCountryParam(undefined, tab), tab).toEqual({ country: undefined, chosen: undefined, countryState: "none" });
      }
    } finally {
      delete g.localStorage;
      delete g.document;
    }
  });

  it("an explicit tracked country is applied on the three discovery tabs and kept on Saved without being applied there", () => {
    for (const tab of ["recommended", "external", "recent"]) {
      expect(resolveCountryParam("Ghana", tab)).toEqual({ country: "Ghana", chosen: "Ghana", countryState: "kept" });
    }
    expect(resolveCountryParam("Ghana", "saved")).toEqual({ country: undefined, chosen: "Ghana", countryState: "none" });
  });

  it("an unknown value is no country; the old country=all link is no country too (it is never written any more, but old bookmarks still work)", () => {
    expect(resolveCountryParam("Atlantis", "recommended")).toMatchObject({ country: undefined, chosen: undefined });
    expect(resolveCountryParam("all", "recommended")).toEqual({ country: undefined, chosen: undefined, countryState: "cleared" });
  });

  it("gives the same answer on every call (a reload, back or forward is the same URL)", () => {
    expect(resolveCountryParam(undefined, "recommended")).toEqual(resolveCountryParam(undefined, "recommended"));
    expect(resolveCountryParam("Kenya", "recent")).toEqual(resolveCountryParam("Kenya", "recent"));
  });
});

describe("countrySuggestion", () => {
  it("suggests a tracked profile country only while nothing is chosen, and never on Saved", () => {
    expect(countrySuggestion("Nigeria", undefined, "recommended")).toBe("Nigeria");
    expect(countrySuggestion("Nigeria", "Ghana", "recommended")).toBeUndefined();
    expect(countrySuggestion("Nigeria", undefined, "saved")).toBeUndefined();
    expect(countrySuggestion("United Kingdom", undefined, "recommended")).toBeUndefined();
    expect(countrySuggestion(null, undefined, "recommended")).toBeUndefined();
  });
});

describe("feedTabHref: changing tab keeps the choice", () => {
  it("carries a chosen country to every tab, including Saved, and carries nothing when none is chosen", () => {
    for (const tab of ["recommended", "external", "recent", "saved"]) {
      expect(feedTabHref(tab, "Ghana")).toBe(`/jobs?tab=${tab}&country=Ghana`);
      expect(feedTabHref(tab, undefined)).toBe(`/jobs?tab=${tab}`);
    }
  });
});

describe("recentPageHref: paging keeps the choice", () => {
  it("includes an explicit country, omits it when none, and never writes country=all", () => {
    expect(recentPageHref({ workTypes: [], seniorities: [], country: "Kenya", target: 2 })).toBe("/jobs?tab=recent&country=Kenya&page=2");
    expect(recentPageHref({ workTypes: ["remote"], seniorities: ["senior"], posted: "week", country: undefined, target: 3 })).toBe(
      "/jobs?tab=recent&workType=remote&seniority=senior&posted=week&page=3",
    );
    expect(recentPageHref({ workTypes: [], seniorities: [], country: undefined, target: 1 })).toBe("/jobs?tab=recent");
  });
});

describe("the helper line under the filters", () => {
  it("says nothing about a country when none is chosen", () => {
    expect(renderToStaticMarkup(<CountryNote country={undefined} />)).toBe("");
  });
  it("names the chosen country when one is", () => {
    const html = renderToStaticMarkup(<CountryNote country="Ghana" />);
    expect(html).toContain("Showing roles in Ghana plus every remote listing");
    expect(html).not.toContain("Nigeria");
  });
});
