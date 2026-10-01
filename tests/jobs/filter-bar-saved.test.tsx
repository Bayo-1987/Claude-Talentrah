/**
 * send-496 / S11 — the Saved tab has no country filter ("No country filter on Saved"). A control that does nothing
 * is worse than none, so the country menu is not rendered there. Every other tab keeps it (the control case).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar } from "@/components/jobs/filter-bar";

const render = (tab: string) =>
  renderToStaticMarkup(<FilterBar tab={tab} country="Nigeria" countryApplicable countryCounts={{ Nigeria: 3, Ghana: 0, Kenya: 0, "South Africa": 0 }} everyCountryCount={9} />);

describe("FilterBar country control by tab", () => {
  it("is present on Recommended (control)", () => {
    const html = render("recommended");
    expect(html).toContain("filter-menu-country-desktop");
    expect(html).toContain("filter-menu-country-mobile");
    expect(html).toContain("Every country");
  });

  it("is absent on Saved: no country menu, no 'Every country', and no country chip", () => {
    const html = render("saved");
    expect(html).not.toContain("filter-menu-country");
    expect(html).not.toContain("Every country");
    expect(html).not.toContain("Nigeria");
  });

  it("does not carry a country param through the Saved tab's own search form or links", () => {
    const html = render("saved");
    expect(html).not.toMatch(/name="country"/);
    expect(html).not.toMatch(/country=/);
  });

  it("keeps work type, seniority and posted on Saved: those are the user's own narrowing", () => {
    const html = render("saved");
    expect(html).toContain("filter-menu-work-type");
    expect(html).toContain("filter-menu-seniority");
    expect(html).toContain("filter-menu-posted");
  });
});
