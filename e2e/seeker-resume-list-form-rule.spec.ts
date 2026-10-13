/**
 * Seeker > Resume Builder > Your resumes (QA, 9 Oct): rename a resume twice in a row (each save is shown and the database follows), a blank name is refused with a message and the row stays in rename mode, Cancel then
 * Rename starts from the saved name; delete asks first by NAME ("Keep it" changes nothing), then deletes (the database row is gone and the list says so); the base resume cannot be deleted from the page.
 * Local stack only, minted session for a throwaway user; two resumes written by the test.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";

test("resume list: rename twice, blank name refused, delete asks by name; base resume is not deletable", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await seedBaseResume(testUser.id);
  const { data: extra, error } = await admin.from("resumes").insert({ user_id: testUser.id, title: "QA second resume", is_base: false, source: "builder", structured_content: { contact: { name: "E2E Tester" }, summary: "x", experience: [], education: [], skills: ["sql"], projects: [], certifications: [] } }).select("id").single();
  if (error || !extra) throw new Error(`fixture resume: ${error?.message}`);
  const titleOf = async () => (await admin.from("resumes").select("title").eq("id", extra.id).maybeSingle()).data?.title;
  await page.goto("/resume-builder");
  const row = () => page.locator("li, div", { has: page.getByText(/QA second resume|QA renamed/) }).filter({ has: page.getByRole("button", { name: "Rename" }) }).last();

  for (const name of ["QA renamed one", "QA renamed two"]) {
    await row().getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Resume name").fill(name);
    await page.getByTestId("resume-rename-save").click();
    await expect.poll(titleOf, { timeout: 30_000 }).toBe(name);
    await expect(page.getByText(name).first()).toBeVisible();
    if (name === "QA renamed one") await shot("1-renamed");
  }

  // Blank name: refused, still renaming.
  await row().getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Resume name").fill("   ");
  await page.getByTestId("resume-rename-save").click();
  await expect(page.getByTestId("resume-rename-error")).toContainText("A resume needs a name", { timeout: 30_000 });
  await expect(page.getByLabel("Resume name"), "still in rename mode after the refusal").toBeVisible();
  expect(await titleOf()).toBe("QA renamed two");
  await shot("2-blank-refused");
  await page.getByTestId("resume-rename-cancel").click();
  await row().getByRole("button", { name: "Rename" }).click();
  await expect(page.getByLabel("Resume name"), "Cancel then Rename starts from the saved name").toHaveValue("QA renamed two");
  await page.getByTestId("resume-rename-cancel").click();

  // Delete: asks by name; Keep it changes nothing; then delete.
  await row().getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("resume-delete-confirm")).toContainText("QA renamed two");
  await page.getByTestId("resume-delete-cancel").click();
  expect(await titleOf()).toBe("QA renamed two");
  await row().getByRole("button", { name: "Delete" }).click();
  await page.getByTestId("resume-delete-confirm-yes").click();
  await expect.poll(titleOf, { timeout: 30_000 }).toBeUndefined();
  await expect(page.getByText("QA renamed two")).toHaveCount(0);
  await shot("3-deleted");

  // The base resume: no live Delete.
  const base = page.locator("li, div", { has: page.getByText("E2E base resume") }).filter({ has: page.getByRole("button", { name: "Rename" }) }).last();
  const del = base.getByRole("button", { name: "Delete" });
  if (await del.count()) await expect(del).toBeDisabled();
});
