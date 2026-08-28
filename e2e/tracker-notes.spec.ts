import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";

/**
 * The tracker note's three states, and what each one is allowed to do to the
 * database.
 *
 * WHY THE DATABASE IS CHECKED AND NOT JUST THE SCREEN. Two of these cases are
 * about a write that must NOT happen — Cancel, and a failed save — and a UI
 * that looks correct is exactly what both bugs would produce. Cancel reverting
 * the text on screen while having already written it is indistinguishable from
 * Cancel working, until someone reloads.
 */

/** A manual entry is the cheapest tracked application: no job posting needed. */
async function seedApplication(userId: string, notes: string | null) {
  const { data, error } = await admin
    .from("applications")
    .insert({
      user_id: userId,
      stage: "applied",
      applied_at: new Date().toISOString(),
      notes,
      manual_job_snapshot: {
        companyName: "Moniepoint",
        title: "Illustrator",
        location: "Remote, Nigeria",
      },
    })
    .select("id, notes, updated_at")
    .single();
  if (error) throw new Error(`fixture application: ${error.message}`);
  return data;
}

async function rowOf(id: string) {
  const { data, error } = await admin
    .from("applications")
    .select("notes, updated_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(`reading application: ${error.message}`);
  return data;
}

/** The card is the only one on the page, so scoping is unnecessary. */
async function openTracker(page: Page) {
  await page.goto("/tracker");
  await page.getByRole("heading", { name: "Illustrator" }).first().waitFor();
}

test.describe("a note with nothing in it", () => {
  test("is a quiet link, and becomes a note", async ({ authedPage, testUser }) => {
    const app = await seedApplication(testUser.id, null);
    await openTracker(authedPage);

    // Empty state: a link, and no compose box demanding input.
    await expect(authedPage.getByTestId("notes-add")).toBeVisible();
    await expect(authedPage.getByTestId("notes-textarea")).toHaveCount(0);
    await expect(authedPage.getByTestId("notes-read")).toHaveCount(0);

    await authedPage.getByTestId("notes-add").click();
    await expect(authedPage.getByTestId("notes-textarea")).toBeVisible();
    await authedPage.getByTestId("notes-textarea").fill("Called recruiter, follow up Friday");
    await authedPage.getByTestId("notes-save").click();

    // Collapses to the read view, with the banner over it.
    await expect(authedPage.getByTestId("notes-read")).toBeVisible();
    await expect(authedPage.getByTestId("notes-saved-banner")).toBeVisible();
    await expect(authedPage.getByTestId("notes-read")).toContainText(
      "Called recruiter, follow up Friday",
    );

    // "Edited <today>" in the same format the card's "Applied" line uses.
    const today = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    await expect(authedPage.getByTestId("notes-read")).toContainText(`Edited ${today}`);

    // The banner is temporary; the read view is the lasting proof.
    await expect(authedPage.getByTestId("notes-saved-banner")).toBeHidden({ timeout: 10_000 });
    await expect(authedPage.getByTestId("notes-read")).toBeVisible();

    const row = await rowOf(app.id);
    expect(row.notes).toBe("Called recruiter, follow up Friday");
    expect(
      new Date(row.updated_at).getTime(),
      "updated_at must actually move — the Edited line is a claim about the row",
    ).toBeGreaterThan(new Date(app.updated_at).getTime());
  });
});

test.describe("Cancel", () => {
  test("reverts the text and writes nothing", async ({ authedPage, testUser }) => {
    const original = "Called recruiter, follow up Friday";
    const app = await seedApplication(testUser.id, original);
    await openTracker(authedPage);

    await expect(authedPage.getByTestId("notes-read")).toContainText(original);

    await authedPage.getByTestId("notes-edit").click();
    await authedPage.getByTestId("notes-textarea").fill("something completely different");
    await authedPage.getByTestId("notes-cancel").click();

    // Back to the saved text, not the abandoned draft.
    await expect(authedPage.getByTestId("notes-read")).toBeVisible();
    await expect(authedPage.getByTestId("notes-read")).toContainText(original);
    await expect(authedPage.getByTestId("notes-read")).not.toContainText("completely different");

    // Re-opening must show the saved text, not what was typed and discarded.
    await authedPage.getByTestId("notes-edit").click();
    await expect(authedPage.getByTestId("notes-textarea")).toHaveValue(original);
    await authedPage.getByTestId("notes-cancel").click();

    /*
     * THE ASSERTION THAT MATTERS. Everything above would also pass if Cancel
     * had saved and the page simply re-rendered the new value consistently.
     * Only the row says which happened.
     */
    const row = await rowOf(app.id);
    expect(row.notes, "Cancel must not write").toBe(original);
    expect(row.updated_at, "Cancel must not touch updated_at").toBe(app.updated_at);
  });
});

test.describe("a multi-line note", () => {
  test("is fully visible in the read view and in the editor", async ({ authedPage, testUser }) => {
    const multi = "Panel is 3 stages:\ndesign task\nculture fit\nthen leadership";
    await seedApplication(testUser.id, multi);
    await openTracker(authedPage);

    // Read view: every line present, and tall enough to be showing them.
    const read = authedPage.getByTestId("notes-read");
    for (const line of ["design task", "culture fit", "then leadership"]) {
      await expect(read).toContainText(line);
    }
    const readHeight = await read.evaluate((el) => el.getBoundingClientRect().height);
    expect(readHeight, "a four-line note rendered at one line's height is clipped").toBeGreaterThan(
      50,
    );

    // Editor: auto-grown, not a one-row slit the user has to drag open.
    await authedPage.getByTestId("notes-edit").click();
    const box = authedPage.getByTestId("notes-textarea");
    await expect(box).toHaveValue(multi);
    const metrics = await box.evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      return { height: t.getBoundingClientRect().height, scrollHeight: t.scrollHeight };
    });
    // The whole point of fitting to scrollHeight: nothing is scrolled out of view.
    expect(metrics.height).toBeGreaterThanOrEqual(metrics.scrollHeight - 2);
    expect(metrics.height).toBeGreaterThan(60);
  });
});

test.describe("when the save fails", () => {
  test("the typed text survives and the error is shown", async ({ authedPage, testUser }) => {
    const original = "Called recruiter, follow up Friday";
    const app = await seedApplication(testUser.id, original);
    await openTracker(authedPage);

    await authedPage.getByTestId("notes-edit").click();
    await authedPage.getByTestId("notes-textarea").fill("a draft worth not losing");

    /*
     * Forcing the failure at the transport rather than by breaking the action:
     * aborting the Server Action POST is the closest thing to the real case
     * this guards — a save that does not land — and it needs no test-only
     * branch in shipped code.
     */
    await authedPage.route("**/tracker**", (route) => {
      if (route.request().method() === "POST") return route.abort("failed");
      return route.continue();
    });

    await authedPage.getByTestId("notes-save").click();

    // Still editing, still holding the draft. That is the requirement.
    await expect(authedPage.getByTestId("notes-textarea")).toBeVisible();
    await expect(authedPage.getByTestId("notes-textarea")).toHaveValue("a draft worth not losing");

    await authedPage.unroute("**/tracker**");

    // And nothing was written.
    const row = await rowOf(app.id);
    expect(row.notes).toBe(original);
  });
});
