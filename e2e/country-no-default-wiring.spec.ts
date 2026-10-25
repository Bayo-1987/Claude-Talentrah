/**
 * The feed page's WIRING for "no country unless the person chose one", end to end in a real browser against the built app (npm run build && npm run start).
 *
 * The unit tests pin the pieces (resolveCountryParam, feedTabHref, the filter bar's links). What none of them can see is whether the feed page hands the RIGHT value to each
 * piece: a wrong variable to FeedTabs, a search form that forgets the country, a chip whose removal comes back. This walks the whole path with a profile country SET (the
 * case that used to default the feed) and asserts the URL and the results never reintroduce a country the person did not choose:
 *
 *   1. /jobs with no param: no country in the URL, "All countries" on the menu face, no chip, no helper line, a visible (unapplied) suggestion; a non-Nigeria posting is listed.
 *   2. a search: no country appears.   3. each of the four tabs: no country appears.
 *   4. choose a country: it appears in the URL and as a chip, and it SURVIVES each of the four tabs and a search.
 *   5. remove the chip: the URL has no country, and a further search and all four tabs add none back, and the non-Nigeria posting is listed again.
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";

const TABS = [
  { name: "Recommended", key: "recommended" },
  { name: "External Jobs", key: "external" },
  { name: "Most Recent", key: "recent" },
  { name: "Saved Jobs", key: "saved" },
] as const;


const countryParam = (page: Page) => new URL(page.url()).searchParams.get("country");

test.describe("no default country: the page wiring", () => {
  const orgIds: string[] = [];
  const jobIds: string[] = [];

  test.afterEach(async () => {
    await runCleanups(
      ["wiring job postings", async () => { if (jobIds.length) await deletePostingsCascade(admin, jobIds.splice(0)); }],
      ["wiring organisations", async () => { if (orgIds.length) await deleteOrgsCascade(admin, orgIds.splice(0)); }],
    );
  });

  async function fixtureJob(orgId: string, title: string, location: string) {
    const { data, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "E2E Wiring Co",
        title,
        description: "A real fixture posting long enough to render on a card in the e2e suite.",
        status: "open",
        location,
        work_type: null,
        seniority: null,
        posted_at: new Date().toISOString(),
        dedup_fingerprint: `e2e-wiring-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
    jobIds.push(data.id);
  }

  test("with a profile country set, no path through the feed adds a country the person did not choose, and a chosen one survives until the chip is removed", async ({ authedPage: page, testUser }) => {
    // Many page loads in one walk (four tabs three times, searches, a reload): well past the 30s default on a busy machine.
    test.setTimeout(120_000);
    await admin.from("profiles").update({ country: "Nigeria" }).eq("id", testUser.id);
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `E2E Wiring Co ${randomUUID().slice(0, 8)}`, created_by: testUser.id, verified: true })
      .select("id")
      .single();
    if (error || !org) throw new Error(`fixture org: ${error?.message}`);
    orgIds.push(org.id);

    const term = `e2ewiring${randomUUID().slice(0, 8)}`;
    const dakar = `Onsite role ${term} in Dakar`;
    for (let i = 0; i < 5; i++) await fixtureJob(org.id, `NG onsite role ${term} ${i}`, "Lagos, Nigeria");
    await fixtureJob(org.id, dakar, "Dakar, Senegal");

    // At desktop width the desktop menu is the visible one; at phone widths the mobile one is. Both always exist in the DOM.
    const menu = () => page.locator('[data-testid^="filter-menu-country-"]:visible').first();
    const face = () => menu().locator("summary");
    const searchBox = () => page.getByRole("combobox", { name: "Search jobs" });
    const submitSearch = async (value: string) => {
      await searchBox().fill(value);
      await searchBox().press("Enter");
    };
    const noCountryAnywhere = async (where: string) => {
      expect(countryParam(page), `${where}: URL has no country`).toBeNull();
      await expect(face(), `${where}: menu face`).toHaveText(/All countries/);
      await expect(page.getByRole("link", { name: /^Remove (Nigeria|Ghana|Kenya|South Africa) filter$/ }), `${where}: no chip`).toHaveCount(0);
      await expect(page.getByText("Showing roles in"), `${where}: no helper line`).toHaveCount(0);
    };

    // 1. No param, profile country set.
    await page.goto("/jobs");
    await noCountryAnywhere("/jobs with no param");
    await expect(page.getByTestId("country-suggestion"), "the profile country is offered, not applied").toHaveText(/Show roles in Nigeria/);

    // 2. A search.
    await submitSearch(term);
    await page.waitForURL((u) => u.searchParams.get("q") === term);
    await noCountryAnywhere("after a search");
    await expect(page.getByText(dakar), "a non-Nigeria posting is in the results: no country filter is applied").toBeVisible();

    // 3. Each of the four tabs (the tab links drop q, as they always have; what matters is that none adds a country).
    for (const tab of TABS) {
      await page.getByRole("link", { name: tab.name, exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("tab") === tab.key);
      if (tab.key === "saved") expect(countryParam(page), "Saved Jobs: URL has no country").toBeNull();
      else await noCountryAnywhere(`tab ${tab.name}`);
    }

    // 4. Choose a country: it shows, and survives each tab and a search.
    await page.goto("/jobs");
    await face().click();
    await menu().getByRole("link", { name: /^Ghana/ }).click();
    await page.waitForURL((u) => u.searchParams.get("country") === "Ghana");
    await expect(page.getByRole("link", { name: "Remove Ghana filter" })).toBeVisible();
    await expect(face()).toHaveText(/Ghana/);
    for (const tab of TABS) {
      await page.getByRole("link", { name: tab.name, exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("tab") === tab.key);
      expect(countryParam(page), `tab ${tab.name} keeps the chosen country`).toBe("Ghana");
      if (tab.key !== "saved") await expect(page.getByRole("link", { name: "Remove Ghana filter" }), `tab ${tab.name}: chip`).toBeVisible();
    }
    await page.getByRole("link", { name: "Recommended", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("tab") === "recommended");
    await submitSearch(term);
    await page.waitForURL((u) => u.searchParams.get("q") === term);
    expect(countryParam(page), "a search keeps the chosen country").toBe("Ghana");
    await expect(page.getByRole("link", { name: "Remove Ghana filter" })).toBeVisible();

    // 5. Remove the chip: nothing brings a country back.
    await page.getByRole("link", { name: "Remove Ghana filter" }).click();
    await page.waitForURL((u) => !u.searchParams.has("country") && u.searchParams.get("q") === term);
    await noCountryAnywhere("after removing the chip");
    await expect(page.getByText(dakar), "the non-Nigeria posting is back").toBeVisible();
    await submitSearch(`${term} role`);
    await page.waitForURL((u) => u.searchParams.get("q") === `${term} role`);
    await noCountryAnywhere("a search after removing the chip");
    await page.reload();
    await noCountryAnywhere("a reload after removing the chip");
    for (const tab of TABS) {
      await page.getByRole("link", { name: tab.name, exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("tab") === tab.key);
      if (tab.key === "saved") expect(countryParam(page), "Saved Jobs after removal: no country").toBeNull();
      else await noCountryAnywhere(`tab ${tab.name} after removing the chip`);
    }
  });
});
