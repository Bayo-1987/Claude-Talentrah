/**
 * Seeker > Job Tracker (QA, 9 Oct): add a job twice in a row (the second entry starts clean), move a card through the stages, hired is terminal (only Archive is allowed from it), and the deliberate errors:
 * (1) a company made only of spaces passes the browser's required check; (2) moving a Hired card to another stage. In both the person must see a readable message, keep what was typed, and the page
 * must stay usable (not a crash screen); the database must be untouched. Local stack only, minted session for a throwaway user.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { settle } from "./support/settle";

test("tracker: add twice, move, hired is terminal; a blank company and a hired-to-interviewing move fail readably", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  page.on("dialog", (d) => d.accept());
  const tag = randomUUID().slice(0, 6);
  const rows = async () => ((await admin.from("applications").select("id, stage, notes, manual_job_snapshot").eq("user_id", testUser.id)).data ?? []) as Array<{ id: string; stage: string; notes: string | null; manual_job_snapshot: { companyName: string; title: string } | null }>;
  const byTitle = async (title: string) => (await rows()).find((r) => r.manual_job_snapshot?.title === title);
  const add = async (company: string, title: string, stage: string, notes = "") => {
    await page.goto("/tracker");
    await page.getByText("+ Add a job you applied to outside Talentrah").click();
    await page.getByLabel("Company").fill(company);
    await page.getByLabel("Job title").fill(title);
    await page.getByLabel("Stage", { exact: true }).selectOption(stage);
    if (notes) await page.getByLabel("Notes (optional)").fill(notes);
    await page.getByRole("button", { name: "Add to tracker" }).click();
  };
  const A = `QA Role A ${tag}`, B = `QA Role B ${tag}`;

  await add(`QA Co A ${tag}`, A, "applied", "first note");
  await expect(page.getByRole("combobox", { name: `Stage for ${A} at QA Co A ${tag}` })).toBeVisible({ timeout: 30_000 });
  await shot("1-first-added");
  // Second entry starts clean.
  await page.getByText("+ Add a job you applied to outside Talentrah").click();
  await expect(page.getByLabel("Company"), "the second entry starts with an empty company").toHaveValue("");
  await expect(page.getByLabel("Job title")).toHaveValue("");
  await expect(page.getByLabel("Notes (optional)")).toHaveValue("");
  await add(`QA Co B ${tag}`, B, "saved");
  await expect(page.getByRole("combobox", { name: `Stage for ${B} at QA Co B ${tag}` })).toBeVisible({ timeout: 30_000 });
  expect((await byTitle(A))?.stage).toBe("applied");
  expect((await byTitle(A))?.notes).toBe("first note");
  expect((await byTitle(B))?.stage).toBe("saved");

  // Move B: saved -> applied -> interviewing.
  const selB = () => page.getByRole("combobox", { name: `Stage for ${B} at QA Co B ${tag}` });
  await selB().selectOption("applied");
  await expect.poll(async () => (await byTitle(B))?.stage, { timeout: 30_000 }).toBe("applied");
  await expect(page.locator(`form:has(select[aria-label="Stage for ${B} at QA Co B ${tag}"]) input[name=expectedStage]`)).toHaveValue("applied", { timeout: 30_000 }); // the card has refreshed
  await selB().selectOption("interviewing");
  await expect.poll(async () => (await byTitle(B))?.stage, { timeout: 30_000 }).toBe("interviewing");
  await shot("2-moved");

  // Hired is terminal.
  const selA = () => page.getByRole("combobox", { name: `Stage for ${A} at QA Co A ${tag}` });
  await selA().selectOption("hired");
  await expect.poll(async () => (await byTitle(A))?.stage, { timeout: 30_000 }).toBe("hired");
  await expect(page.locator(`form:has(select[aria-label="Stage for ${A} at QA Co A ${tag}"]) input[name=expectedStage]`)).toHaveValue("hired", { timeout: 30_000 });
  await selA().selectOption("interviewing");
  await settle(page);
  await shot("3-hired-to-interviewing");
  expect((await byTitle(A))?.stage, "hired is terminal: the database refuses").toBe("hired");
  const crashed = await page.getByText(/This page couldn.t load|Something went wrong|Application error/i).count();
  expect.soft(crashed, "TRACKER-HIRED-1: moving a hired card shows a crash screen instead of a readable message").toBe(0);
  await page.goto("/tracker");
  await page.getByRole("combobox", { name: `Stage for ${A} at QA Co A ${tag}` }).selectOption("archived");
  await expect.poll(async () => (await byTitle(A))?.stage, { timeout: 30_000 }).toBe("archived");

  // Deliberate error: a company of spaces.
  await page.goto("/tracker");
  await page.getByText("+ Add a job you applied to outside Talentrah").click();
  await page.getByLabel("Company").fill("    ");
  await page.getByLabel("Job title").fill(`QA Role C ${tag}`);
  await page.getByLabel("Notes (optional)").fill("typed before the error");
  await page.getByRole("button", { name: "Add to tracker" }).click();
  await settle(page);
  await shot("4-blank-company");
  expect.soft(await page.getByText(/This page couldn.t load|Something went wrong|Application error/i).count(), "TRACKER-ADD-1: a blank company shows a crash screen instead of a readable message").toBe(0);
  expect((await rows()).filter((r) => r.manual_job_snapshot?.title === `QA Role C ${tag}`), "nothing was added").toHaveLength(0);
  // The refusal keeps what was typed (job title and notes; the company is the field that was wrong).
  await expect.soft(page.getByLabel("Job title"), "TRACKER-KEEP-1: the job title typed is kept").toHaveValue(`QA Role C ${tag}`);
  await expect.soft(page.getByLabel("Notes (optional)"), "TRACKER-KEEP-1: the notes typed are kept").toHaveValue("typed before the error");
});
