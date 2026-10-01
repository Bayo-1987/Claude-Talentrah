/**
 * send-496 / S11 — the feed's Saved tab is the tracker's Saved stage: one set.
 *
 * The owner had 5 items in the tracker's Saved stage and none on the feed's Saved tab. There is no separate saved
 * table (the heart writes the tracker row); the tab was FILTERING the set the way it filters the discovery feed:
 * open postings only, nothing older than 30 days, and a country default that, below 5 matches, printed "showing roles
 * from elsewhere" next to "No saved jobs yet". Fixtures here reproduce each cause. Country is set to Nigeria on the
 * test user and every posting is located in London, so a country filter WOULD hide them.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade } from "../tests/support/delete-orgs";

const createdJobIds: string[] = [];

test.afterEach(async () => {
  await runCleanups([
    "saved-tab job postings",
    async () => {
      if (createdJobIds.length) await deletePostingsCascade(admin, createdJobIds.splice(0));
    },
  ]);
});

async function setCountry(userId: string, country: string) {
  const { error } = await admin.from("profiles").update({ country }).eq("id", userId);
  if (error) throw new Error(`fixture country: ${error.message}`);
}

async function fixturePosting(over: { status: "open" | "closed"; postedDaysAgo: number; title: string; company: string }) {
  const posted = new Date(Date.now() - over.postedDaysAgo * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      organization_id: null,
      company_name: over.company,
      title: over.title,
      description: "A real fixture posting long enough to render.",
      status: over.status,
      closed_at: over.status === "closed" ? new Date().toISOString() : null,
      location: "London, United Kingdom",
      posted_at: posted,
      external_url: "https://example.test/saved-tab-fixture",
      dedup_fingerprint: `e2e-saved-${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  createdJobIds.push(data.id);
  return data.id;
}

async function saveRow(userId: string, jobId: string | null, title: string, company: string) {
  const { data, error } = await admin
    .from("applications")
    .insert({
      user_id: userId,
      job_posting_id: jobId,
      stage: "saved",
      source: "manual",
      manual_job_snapshot: { companyName: company, title, location: "London, United Kingdom", url: jobId ? "https://example.test/saved-tab-fixture" : undefined },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture saved row: ${error?.message}`);
  return data.id;
}

test.describe("the Saved tab", () => {
  test("with nothing saved, says so ONCE, and never claims to be 'showing roles from elsewhere'", async ({ authedPage, testUser }) => {
    await setCountry(testUser.id, "Nigeria");
    await authedPage.goto("/jobs?tab=saved");
    await expect(authedPage.getByText("No saved jobs yet")).toBeVisible();
    const body = await authedPage.locator("main").innerText();
    expect(body, "the country fallback notice contradicted the empty state").not.toMatch(/showing roles from elsewhere/i);
    expect(body).not.toMatch(/No jobs in Nigeria/);
    expect(body, "no country caption on Saved").not.toMatch(/Showing roles in Nigeria/);
    // One empty state, not two.
    await expect(authedPage.getByText(/No saved jobs yet|None of your saved jobs match/)).toHaveCount(1);
  });

  test("shows every saved tracker row: a closed role, an old open role, and a manual entry, whatever the country", async ({ authedPage, testUser }) => {
    await setCountry(testUser.id, "Nigeria");
    const tag = randomUUID().slice(0, 6);
    const closedTitle = `Closed Saved Role ${tag}`;
    const oldTitle = `Old Open Saved Role ${tag}`;
    const manualTitle = `Manual Saved Role ${tag}`;
    const closedId = await fixturePosting({ status: "closed", postedDaysAgo: 3, title: closedTitle, company: "Closed Co" });
    const oldId = await fixturePosting({ status: "open", postedDaysAgo: 60, title: oldTitle, company: "Old Co" });
    await saveRow(testUser.id, closedId, closedTitle, "Closed Co");
    await saveRow(testUser.id, oldId, oldTitle, "Old Co");
    await saveRow(testUser.id, null, manualTitle, "Manual Co");

    await authedPage.goto("/jobs?tab=saved");

    // The old-but-open posting is a normal job card (the 30-day floor no longer hides a saved one).
    await expect(authedPage.getByRole("heading", { name: oldTitle })).toBeVisible();

    // The closed one says so, and is never offered Apply.
    const closedCard = authedPage.getByTestId("saved-entry-card").filter({ hasText: closedTitle });
    await expect(closedCard).toBeVisible();
    await expect(closedCard.getByText("This role has closed")).toBeVisible();
    await expect(closedCard.getByRole("button", { name: /apply/i })).toHaveCount(0);
    await expect(closedCard.getByRole("link", { name: /apply/i })).toHaveCount(0);

    // The manual entry renders from its snapshot.
    const manualCard = authedPage.getByTestId("saved-entry-card").filter({ hasText: manualTitle });
    await expect(manualCard).toBeVisible();
    await expect(manualCard.getByText("Added by you")).toBeVisible();

    const body = await authedPage.locator("main").innerText();
    expect(body).not.toMatch(/showing roles from elsewhere/i);
    expect(body).not.toMatch(/No saved jobs yet/);
  });

  test("Remove on a closed role takes it off the Saved tab and out of the tracker's Saved stage", async ({ authedPage, testUser }) => {
    const title = `Removable Closed Role ${randomUUID().slice(0, 6)}`;
    const jobId = await fixturePosting({ status: "closed", postedDaysAgo: 5, title, company: "Gone Co" });
    const appId = await saveRow(testUser.id, jobId, title, "Gone Co");

    await authedPage.goto("/jobs?tab=saved");
    const card = authedPage.getByTestId("saved-entry-card").filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Remove" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });

    const { data } = await admin.from("applications").select("id").eq("id", appId);
    expect(data, "the saved row should be gone").toEqual([]);
  });

  test("a search that matches nothing says the saved jobs don't match, not that nothing is saved", async ({ authedPage, testUser }) => {
    const title = `Searchable Saved Role ${randomUUID().slice(0, 6)}`;
    await saveRow(testUser.id, null, title, "Search Co");
    await authedPage.goto(`/jobs?tab=saved&q=${encodeURIComponent(title)}`);
    await expect(authedPage.getByTestId("saved-entry-card").filter({ hasText: title })).toBeVisible();

    await authedPage.goto("/jobs?tab=saved&q=zzzz-no-such-saved-job");
    await expect(authedPage.getByText(/None of your saved jobs match/)).toBeVisible();
    await expect(authedPage.getByText("No saved jobs yet")).toHaveCount(0);
  });
});
