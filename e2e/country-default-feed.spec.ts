/**
 * Stage 12's feed-level properties that a database-level test cannot show on
 * its own: the honest fallback notice actually rendering instead of a blank
 * feed, the country chip actually surviving alongside another filter and
 * actually clearing, Most Recent staying purely date-ordered next to
 * Recommended's new decay, and /jobs/remote vs. /jobs/remote/nigeria only
 * ever claiming a country each has actually filtered on.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

test.describe("country-defaulted feed (Stage 12)", () => {
  const createdOrgIds: string[] = [];
  const createdJobIds: string[] = [];

  test.afterEach(async () => {
    await runCleanups(
      [
        "country-default job postings",
        async () => {
          if (createdJobIds.length) await deletePostingsCascade(admin, createdJobIds.splice(0));
        },
      ],
      [
        "country-default organisations",
        async () => {
          if (createdOrgIds.length) await deleteOrgsCascade(admin, createdOrgIds.splice(0));
        },
      ],
    );
  });

  async function fixtureOrg(testUserId: string): Promise<string> {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `E2E Country Co ${randomUUID().slice(0, 8)}`, created_by: testUserId, verified: true })
      .select("id")
      .single();
    if (error || !org) throw new Error(`fixture org: ${error?.message}`);
    createdOrgIds.push(org.id);
    return org.id;
  }

  async function fixtureJob(
    orgId: string,
    title: string,
    location: string,
    overrides: { postedAt?: string; workType?: "remote" | null } = {},
  ): Promise<string> {
    const { data: job, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "E2E Country Co",
        title,
        description: "A real fixture posting long enough to render on a card in the e2e suite.",
        status: "open",
        location,
        work_type: overrides.workType ?? null,
        posted_at: overrides.postedAt ?? isoAgo(0),
        dedup_fingerprint: `e2e-country-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`fixture posting: ${error?.message}`);
    createdJobIds.push(job.id);
    return job.id;
  }

  test(
    "a country with zero matches under the active search still shows the rest of the board, " +
      "with an honest line — never a blank feed",
    async ({ authedPage, testUser }) => {
      await admin.from("profiles").update({ country: "Nigeria" }).eq("id", testUser.id);
      const orgId = await fixtureOrg(testUser.id);

      // Isolated from the rest of the (shared, populated) board via a unique
      // search term — neither fixture is Nigeria-derivable, so under this
      // search the country filter has exactly zero real matches.
      const uniqueTerm = `e2ecountryzero${randomUUID().slice(0, 8)}`;
      const dakarTitle = `Role about ${uniqueTerm} in Dakar`;
      const nairobiTitle = `Role about ${uniqueTerm} in Nairobi`;
      await fixtureJob(orgId, dakarTitle, "Dakar, Senegal");
      await fixtureJob(orgId, nairobiTitle, "Nairobi, Kenya");

      await authedPage.goto(`/jobs?q=${uniqueTerm}`);

      await expect(
        authedPage.getByText("No jobs in Nigeria match these filters", { exact: false }),
        "SABOTAGE-PROOF TARGET: the honest fallback line must render, not a blank feed",
      ).toBeVisible();
      // "Show what exists and then the rest": the country's own (zero) matches
      // aside, the rest of the board — both fixtures — must still be visible,
      // not silently excluded because a country filter was in play.
      await expect(authedPage.getByText(dakarTitle)).toBeVisible();
      await expect(authedPage.getByText(nairobiTitle)).toBeVisible();
    },
  );

  test(
    "the country chip is visible, composes with another filter, and clearing it removes only itself",
    async ({ authedPage, testUser }) => {
      await admin.from("profiles").update({ country: "Nigeria" }).eq("id", testUser.id);
      const orgId = await fixtureOrg(testUser.id);

      const uniqueTerm = `e2ecountrycompose${randomUUID().slice(0, 8)}`;
      // 6 Nigeria-derivable remote fixtures — above COUNTRY_THIN_THRESHOLD (5)
      // — so the country filter actually narrows the board rather than
      // falling back, letting this test also prove composition with
      // Work type: remote.
      for (let i = 0; i < 6; i++) {
        await fixtureJob(orgId, `Remote NG role ${uniqueTerm} ${i}`, "Lagos, Nigeria", { workType: "remote" });
      }
      const nonNigeriaTitle = `Remote elsewhere ${uniqueTerm}`;
      await fixtureJob(orgId, nonNigeriaTitle, "Dakar, Senegal", { workType: "remote" });

      await authedPage.goto(`/jobs?q=${uniqueTerm}&workType=remote`);

      // Both filters show as applied chips together.
      const appliedFilters = authedPage.getByTestId("applied-filters");
      await expect(appliedFilters.getByText("Nigeria", { exact: true })).toBeVisible();
      await expect(appliedFilters.getByText("Remote", { exact: true })).toBeVisible();
      // Country actually narrowed the board: the non-Nigeria fixture is gone.
      await expect(
        authedPage.getByText(nonNigeriaTitle),
        "SABOTAGE-PROOF TARGET: Work type alone must not be enough to show a non-Nigeria posting",
      ).toHaveCount(0);

      // Clearing ONLY the country chip: Work type survives, the non-Nigeria
      // fixture reappears.
      await appliedFilters.getByLabel("Remove Nigeria filter").click();
      await authedPage.waitForURL(/country=all/);
      await expect(authedPage.getByText(nonNigeriaTitle)).toBeVisible();
      await expect(
        authedPage.getByLabel("Remove Remote filter"),
        "clearing the country chip must not also clear Work type",
      ).toBeVisible();
    },
  );

  test(
    "Most Recent stays purely date-ordered even though Recommended now decays by age",
    async ({ authedPage, testUser }) => {
      const orgId = await fixtureOrg(testUser.id);
      const uniqueTerm = `e2erecentorder${randomUUID().slice(0, 8)}`;
      const olderTitle = `Older role ${uniqueTerm}`;
      const newerTitle = `Newer role ${uniqueTerm}`;
      // Older posted first so a naive "insertion order" pass would put it
      // first too — only an actual date sort proves this.
      await fixtureJob(orgId, olderTitle, "Lagos, Nigeria", { postedAt: isoAgo(5) });
      await fixtureJob(orgId, newerTitle, "Lagos, Nigeria", { postedAt: isoAgo(0) });

      await authedPage.goto(`/jobs?tab=recent&q=${uniqueTerm}`);
      const titles = await authedPage.locator("h3").allTextContents();
      const newerIndex = titles.findIndex((t) => t.includes(newerTitle));
      const olderIndex = titles.findIndex((t) => t.includes(olderTitle));
      expect(newerIndex).toBeGreaterThanOrEqual(0);
      expect(olderIndex).toBeGreaterThanOrEqual(0);
      expect(
        newerIndex,
        "SABOTAGE-PROOF TARGET: Most Recent must stay purely date-ordered, unaffected by decay",
      ).toBeLessThan(olderIndex);
    },
  );

  test("/jobs/remote never claims a country, and /jobs/remote/nigeria only ever shows what it filtered to", async ({
    authedPage,
    testUser,
  }) => {
    const orgId = await fixtureOrg(testUser.id);
    const uniqueTerm = `e2eremotecountry${randomUUID().slice(0, 8)}`;
    const nigeriaTitle = `NG remote ${uniqueTerm}`;
    const senegalTitle = `Senegal remote ${uniqueTerm}`;
    // Several Nigeria fixtures, not just one: /jobs/remote/nigeria 404s below
    // LANDING_PAGE_MIN_ENTRIES (5) real matches, and this test must not
    // depend on however much ambient Nigeria-remote inventory the shared CI
    // board happens to already have.
    for (let i = 0; i < 5; i++) {
      await fixtureJob(orgId, `${nigeriaTitle} ${i}`, "Lagos, Nigeria", { workType: "remote" });
    }
    await fixtureJob(orgId, senegalTitle, "Dakar, Senegal", { workType: "remote" });

    await authedPage.goto("/jobs/remote");
    const generalTitle = await authedPage.title();
    for (const country of ["Nigeria", "Ghana", "Kenya", "South Africa"]) {
      expect(
        generalTitle,
        `SABOTAGE-PROOF TARGET: /jobs/remote's title must not claim ${country}`,
      ).not.toContain(country);
    }

    await authedPage.goto("/jobs/remote/nigeria");
    expect(await authedPage.title()).toContain("Nigeria");
    await expect(authedPage.getByText(`${nigeriaTitle} 0`)).toBeVisible();
    await expect(
      authedPage.getByText(senegalTitle),
      "a country-specific remote page must not show a posting from a different country",
    ).toHaveCount(0);
  });
});
