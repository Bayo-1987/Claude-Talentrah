/**
 * No country filter unless the person chose one: the markup and the source sites.
 *
 * Owner report (talentrah.com/jobs?tab=recommended&q=project+manager): every jobs search carried a "Nigeria" chip nobody chose, and removing it did not stick. The
 * default came from the profile (jobs/(feed)/page.tsx: `country = defaultCountryForProfile(profile.country)` whenever the URL had no country). The rule now: a country is
 * applied only when the URL carries one. Absent = all countries. These tests pin the places that used to say otherwise.
 *
 * Page-level behaviour is pinned two ways, because the feed page is a 1,300-line async Server Component that cannot be rendered without hand-written module factories
 * (tests/ci/mock-factory-ratchet.test.ts forbids adding them): the pure helpers it now calls are tested in country-urls.test.ts, and here the page SOURCE is read as a
 * syntax tree to prove it cannot reach the profile's country, a cookie or a stored value to decide the filter.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { FilterBar } from "@/components/jobs/filter-bar";

const render = (props: Partial<Parameters<typeof FilterBar>[0]> = {}) => renderToStaticMarkup(<FilterBar tab="recommended" {...props} />);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const hrefOfLink = (html: string, text: string) => html.match(new RegExp(`href="([^"]*)"[^>]*>${text}<`))?.[1]?.replace(/&amp;/g, "&");

describe("FilterBar with no country chosen", () => {
  it("shows no country chip, and the menu's face says All countries", () => {
    const html = render();
    expect(html).not.toContain("Remove Nigeria filter");
    expect(html).not.toMatch(/aria-label="Remove (Nigeria|Ghana|Kenya|South Africa) filter"/);
    expect(html).toContain("All countries");
  });

  it("lists All countries FIRST in the dropdown, then the countries, in both the desktop and the mobile menu", () => {
    const html = render({ countryCounts: { Nigeria: 3, Ghana: 2, Kenya: 1, "South Africa": 4 }, everyCountryCount: 9 });
    for (const id of ["filter-menu-country-desktop", "filter-menu-country-mobile"]) {
      const menu = html.slice(html.indexOf(`data-testid="${id}"`));
      const labels = [...menu.slice(0, menu.indexOf("</details>")).matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
      expect(labels, id).toEqual(["All countries", "Nigeria", "Ghana", "Kenya", "South Africa"]);
    }
  });

  it("writes no country into the search form, the facet links or Clear filters (absent means all)", () => {
    const html = render({ workTypes: ["remote"], seniorities: ["senior"], posted: "week", q: "project manager" });
    expect(html).not.toContain('name="country"');
    const inner = hrefs(html).filter((h) => !/[?&]country=(Nigeria|Ghana|Kenya|South%20Africa|South\+Africa)/.test(h) || true);
    // the only links allowed to name a country are the four country rows themselves
    const naming = inner.filter((h) => /country=/.test(h));
    expect(naming).toHaveLength(8); // four countries x desktop and mobile menus
    for (const label of ["Remote", "Hybrid", "Onsite", "Entry", "Senior", "Past week"]) {
      const h = hrefOfLink(html, label);
      if (h) expect(h, label).not.toMatch(/country=/);
    }
  });

  it("the All countries row is selected and links to a URL with no country param at all", () => {
    const html = render({ q: "project manager" });
    const row = html.match(/<a [^>]*href="([^"]*)"[^>]*><span>All countries<\/span>/);
    expect(row, "All countries row").not.toBeNull();
    expect(row![1].replace(/&amp;/g, "&")).toBe("/jobs?tab=recommended&q=project+manager");
    expect(row![0]).toContain("font-bold text-rust");
  });
});

describe("FilterBar with a country the person chose", () => {
  it("shows that country as a chip and on the button's face", () => {
    const html = render({ country: "Ghana" });
    expect(html).toContain('aria-label="Remove Ghana filter"');
    expect(html).toContain(">Ghana<");
  });

  it("removing the chip, or choosing the same country again, gives a URL with NO country param (not country=all)", () => {
    const html = render({ country: "Ghana", workTypes: ["remote"], q: "pm" });
    const chip = html.match(/aria-label="Remove Ghana filter"[^>]*href="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
    expect(chip).toBe("/jobs?tab=recommended&workType=remote&q=pm");
    const again = html.match(/href="([^"]*)"[^>]*><span>Ghana<\/span>/)?.[1]?.replace(/&amp;/g, "&");
    expect(again).toBe("/jobs?tab=recommended&workType=remote&q=pm");
  });

  it("keeps the choice through a search, a seniority change, a work type change and a posted change", () => {
    const html = render({ country: "Kenya", workTypes: ["remote"], seniorities: ["senior"], posted: "week" });
    expect(html).toContain('name="country" value="Kenya"');
    expect(hrefOfLink(html, "Hybrid")).toContain("country=Kenya");
    expect(hrefOfLink(html, "Lead")).toContain("country=Kenya");
    expect(hrefOfLink(html, "Past 24 hours") ?? hrefOfLink(html, "Past week")).toContain("country=Kenya");
  });

  it("EVERY link in the bar (desktop rows, mobile menus, chips) keeps the choice, except exactly the ones whose job is to drop it", () => {
    const html = render({ country: "Kenya", workTypes: ["remote"], seniorities: ["senior"], posted: "week", q: "pm", countryCounts: { Nigeria: 1, Ghana: 1, Kenya: 1, "South Africa": 1 }, everyCountryCount: 4 });
    const all = hrefs(html);
    const without = all.filter((h) => !h.includes("country=")).sort();
    const dropped = "/jobs?tab=recommended&workType=remote&seniority=senior&q=pm&posted=week";
    // Without any country: All countries (desktop and mobile menu), Kenya again to toggle it off (both menus), and the country chip's own removal, each the same URL
    // minus the country; plus Clear filters, which clears everything. Anything else without the country is a facet link that forgot it.
    expect(without).toEqual(["/jobs?tab=recommended", dropped, dropped, dropped, dropped, dropped].sort());
    // Every link that names a country (the rows for the OTHER countries, and the facet links; not the chips, whose job is to drop one filter) keeps every other filter.
    const notChips = [...html.matchAll(/<a ([^>]*)>/g)].filter((m) => !/aria-label="Remove /.test(m[1])).map((m) => m[1].match(/href="([^"]*)"/)![1].replace(/&amp;/g, "&"));
    for (const h of notChips.filter((x) => x.includes("country="))) {
      if (/country=(Nigeria|Ghana|South\+Africa)$/.test(h)) {
        // a row for another country keeps every filter
        for (const f of ["workType=remote", "seniority=senior", "posted=week", "q=pm"]) expect(h, h).toContain(f);
      } else {
        // a facet link carries the chosen country
        expect(h, h).toContain("country=Kenya");
      }
    }
  });

  it("Clear filters drops the country along with the other filters, and never writes country=all", () => {
    const html = render({ country: "Kenya", workTypes: ["remote"] });
    const clear = html.match(/href="([^"]*)">Clear filters/)?.[1]?.replace(/&amp;/g, "&");
    expect(clear).toBe("/jobs?tab=recommended");
    expect(html).not.toContain("country=all");
  });
});

describe("a profile or location country is only ever a visible suggestion", () => {
  it("offers 'Show roles in Nigeria' as a link, applies nothing, and shows no chip", () => {
    const html = render({ suggestedCountry: "Nigeria" });
    expect(html).toContain("Show roles in Nigeria");
    expect(html).not.toContain('aria-label="Remove Nigeria filter"');
    expect(html).toContain("All countries");
    expect(html.match(/href="([^"]*)"[^>]*>Show roles in Nigeria/)?.[1]).toBe("/jobs?tab=recommended&amp;country=Nigeria");
  });

  it("is not offered once a country is chosen, nor on the Saved tab", () => {
    expect(render({ country: "Ghana", suggestedCountry: "Nigeria" })).not.toContain("Show roles in");
    expect(renderToStaticMarkup(<FilterBar tab="saved" {...({ suggestedCountry: "Nigeria" })} />)).not.toContain("Show roles in");
  });
});

// ---- the sources -----------------------------------------------------------------------------------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const parse = (rel: string) => ts.createSourceFile(rel, readFileSync(path.join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = (n: ts.Node, pred: (x: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const walk = (x: ts.Node) => {
    if (pred(x)) out.push(x);
    ts.forEachChild(x, walk);
  };
  walk(n);
  return out;
};

describe("the feed page cannot reach a profile, cookie or stored country to decide the filter", () => {
  const rel = "src/app/(app)/jobs/(feed)/page.tsx";
  const file = parse(rel);
  const lineOf = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  it("does not use defaultCountryForProfile (the line that used to default the feed to the profile's country)", () => {
    const uses = all(file, (n) => ts.isIdentifier(n) && n.text === "defaultCountryForProfile");
    expect(uses.map((n) => `${rel}:${lineOf(n)} ${n.parent.getText().slice(0, 70)}`)).toEqual([]);
  });

  it("reads the profile's country only to OFFER it (as the argument of countrySuggestion), never to set `country`", () => {
    const reads = all(file, (n) => ts.isPropertyAccessExpression(n) && n.name.text === "country" && /(^|\.)profile$/.test(n.expression.getText()));
    for (const r of reads) {
      const call = r.parent;
      const ok = ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "countrySuggestion";
      expect(ok, `${rel}:${lineOf(r)} ${call.getText().slice(0, 80)}`).toBe(true);
    }
  });

  it("decides the filter from the URL param through resolveCountryParam, and touches no cookie, localStorage, header or geo value for it", () => {
    const calls = all(file, (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "resolveCountryParam");
    expect(calls, "resolveCountryParam(params.country, tab) is called once").toHaveLength(1);
    const banned = all(file, (n) => ts.isIdentifier(n) && /^(cookies|headers|localStorage|sessionStorage|geolocation|detectCountry|countryFromIp)$/.test(n.text));
    expect(banned.map((n) => `${rel}:${lineOf(n)} ${n.getText()}`)).toEqual([]);
  });

  it("never writes country=all into a link it builds (absent means all)", () => {
    expect(readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/country=all|"country",\s*"all"/);
  });
});

describe("the job detail page does not invent a country state from the profile", () => {
  it("does not import defaultCountryForProfile", () => {
    const file = parse("src/app/(app)/jobs/[id]/page.tsx");
    expect(all(file, (n) => ts.isIdentifier(n) && n.text === "defaultCountryForProfile").map((n) => n.getText())).toEqual([]);
  });
});
