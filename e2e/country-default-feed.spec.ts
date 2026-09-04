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
    overrides: {
      postedAt?: string;
      workType?: "remote" | null;
      seniority?: "entry" | "mid" | "senior" | "lead" | "executive" | null;
    } = {},
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
        seniority: overrides.seniority ?? null,
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
    "a country with zero matches (country or remote) under the active search still shows " +
      "the rest of the board, with an honest line — never a blank feed",
    async ({ authedPage, testUser }) => {
      await admin.from("profiles").update({ country: "Nigeria" }).eq("id", testUser.id);
      const orgId = await fixtureOrg(testUser.id);

      // Isolated from the rest of the (shared, populated) board via a unique
      // search term — neither fixture is Nigeria-derivable NOR remote, so
      // under this search the country-or-remote filter has exactly zero
      // real matches.
      const uniqueTerm = `e2ecountryzero${randomUUID().slice(0, 8)}`;
      const dakarTitle = `Role about ${uniqueTerm} in Dakar`;
      const nairobiTitle = `Role about ${uniqueTerm} in Nairobi`;
      await fixtureJob(orgId, dakarTitle, "Dakar, Senegal");
      await fixtureJob(orgId, nairobiTitle, "Nairobi, Kenya");

      await authedPage.goto(`/jobs?q=${uniqueTerm}`);

      await expect(
        authedPage.getByText("No jobs in Nigeria or remote match these filters", { exact: false }),
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
    "the country chip reads 'Nigeria + Remote', composes with another filter, includes a " +
      "non-Nigeria remote posting, excludes a non-Nigeria non-remote one, and clears cleanly",
    async ({ authedPage, testUser }) => {
      await admin.from("profiles").update({ country: "Nigeria" }).eq("id", testUser.id);
      const orgId = await fixtureOrg(testUser.id);

      const uniqueTerm = `e2ecountrycompose${randomUUID().slice(0, 8)}`;
      // 5 Nigeria onsite fixtures — above COUNTRY_THIN_THRESHOLD (5) on
      // their own, so the filter actually narrows rather than falling back,
      // regardless of how much remote inventory the shared CI board
      // ambiently has.
      for (let i = 0; i < 5; i++) {
        await fixtureJob(orgId, `NG onsite role ${uniqueTerm} ${i}`, "Lagos, Nigeria", {
          seniority: "senior",
        });
      }
      // SABOTAGE-PROOF TARGET (inclusion): remote, but named to a DIFFERENT
      // country — Thread 1's whole point is that this must still show,
      // because "remote" is the qualifying fact, not which country it names.
      const remoteElsewhereTitle = `Remote elsewhere ${uniqueTerm}`;
      await fixtureJob(orgId, remoteElsewhereTitle, "Dakar, Senegal", {
        workType: "remote",
        seniority: "senior",
      });
      // Control (exclusion): neither Nigeria-derivable NOR remote — must
      // still be excluded, proving the filter isn't a no-op.
      const onsiteElsewhereTitle = `Onsite elsewhere ${uniqueTerm}`;
      await fixtureJob(orgId, onsiteElsewhereTitle, "Dakar, Senegal", { seniority: "senior" });

      await authedPage.goto(`/jobs?q=${uniqueTerm}&seniority=senior`);

      // Both filters show as applied chips together, with the new label.
      const appliedFilters = authedPage.getByTestId("applied-filters");
      await expect(appliedFilters.getByText("Nigeria + Remote", { exact: true })).toBeVisible();
      await expect(appliedFilters.getByText("Senior", { exact: true })).toBeVisible();

      await expect(
        authedPage.getByText(remoteElsewhereTitle),
        "SABOTAGE-PROOF TARGET: a remote posting must show regardless of which country it names",
      ).toBeVisible();
      await expect(
        authedPage.getByText(onsiteElsewhereTitle),
        "a non-Nigeria, non-remote posting must still be excluded — the filter must not be a no-op",
      ).toHaveCount(0);

      // Clearing ONLY the country chip: Seniority survives, the excluded
      // onsite-elsewhere fixture reappears.
      await appliedFilters.getByLabel("Remove Nigeria + Remote filter").click();
      await authedPage.waitForURL(/country=all/);
      await expect(authedPage.getByText(onsiteElsewhereTitle)).toBeVisible();
      await expect(
        authedPage.getByLabel("Remove Senior filter"),
        "clearing the country chip must not also clear Seniority",
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
