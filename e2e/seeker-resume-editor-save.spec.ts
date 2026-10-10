/**
 * Seeker > Resume Builder > editor Save (QA, 9 Oct): edit and Save twice in a row (the button reads "Saved", turns back to "Save" on the next edit, the database holds the latest, a reload shows it). Then two
 * deliberate errors: (1) the resume is deleted elsewhere while the editor is open: Save must NOT claim "Saved" for something that was not saved; (2) the session ends while the editor is open: the person must
 * be told, not lose the edit on a crash screen. Local stack only, minted session for a throwaway user; the session is ended by removing its server-side row from the LOCAL database.
 */
import { execFileSync } from "node:child_process";
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { settle } from "./support/settle";

async function openEditor(page: import("@playwright/test").Page, resumeId: string) {
  await page.goto(`/resume-builder/edit?resumeId=${resumeId}`);
  await expect(page.getByRole("button", { name: /^(Save|Saved)$/ }).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("resume editor save", () => {
  test("two saves in a row persist and reload", async ({ authedPage: page, testUser }, info) => {
    test.setTimeout(120_000);
    await seedBaseResume(testUser.id);
    const { data: r } = await admin.from("resumes").select("id").eq("user_id", testUser.id).single();
    const summary = async () => ((await admin.from("resumes").select("structured_content").eq("id", r!.id).single()).data!.structured_content as { summary?: string }).summary;
    await openEditor(page, r!.id);
    const box = page.getByRole("textbox", { name: /summary/i }).first();
    for (const text of ["Summary version one by QA.", "Summary version two by QA."]) {
      await box.click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(text);
      await page.getByRole("button", { name: /^(Save|Saved)$/ }).first().click();
      await expect.poll(summary, { timeout: 30_000 }).toBe(text);
      await expect(page.getByRole("button", { name: "Saved" }).first()).toBeVisible();
    }
    await info.attach("saved", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.reload();
    await expect(page.locator("body")).toContainText("Summary version two by QA.");
  });

  test("RESUME-SAVE-1 (P3 observation): the resume was deleted elsewhere; Save does not say Saved, but the page just returns to the list with no explanation and the edit is gone", async ({ authedPage: page, testUser }, info) => {
    test.setTimeout(90_000);
    await seedBaseResume(testUser.id);
    const { data: r } = await admin.from("resumes").select("id").eq("user_id", testUser.id).single();
    await openEditor(page, r!.id);
    await admin.from("resumes").delete().eq("id", r!.id);
    const box = page.getByRole("textbox", { name: /summary/i }).first();
    await box.click();
    await page.keyboard.type(" typed after it was deleted");
    await page.getByRole("button", { name: /^(Save|Saved)$/ }).first().click();
    await settle(page);
    await info.attach("after-save", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const gone = (await admin.from("resumes").select("id").eq("id", r!.id)).data ?? [];
    expect(gone).toHaveLength(0);
    expect.soft(await page.getByRole("button", { name: "Saved" }).count(), "the button claims Saved although the resume no longer exists and nothing was written").toBe(0);
  });

  test("RESUME-SAVE-2: the session ended while editing; the person is told and keeps the page", async ({ authedPage: page, testUser }, info) => {
    test.setTimeout(90_000);
    await seedBaseResume(testUser.id);
    const { data: r } = await admin.from("resumes").select("id").eq("user_id", testUser.id).single();
    await openEditor(page, r!.id);
    const box = page.getByRole("textbox", { name: /summary/i }).first();
    await box.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Edit typed just before the session ended.");
    try {
      execFileSync("docker", ["exec", "supabase_db_Claude_Talentrah", "psql", "-U", "postgres", "-c", `delete from auth.sessions where user_id = '${testUser.id}'`], { stdio: "pipe", env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}`, DOCKER_HOST: `unix://${process.env.HOME}/.docker/run/docker.sock` } });
    } catch (e) { test.skip(true, `could not end the local session: ${(e as Error).message}`); }
    await page.getByRole("button", { name: /^(Save|Saved)$/ }).first().click();
    // The outcome is observable: either a message in place, or the app has moved the person to sign in. Either way the page must not turn into a crash screen.
    await expect.poll(async () => { const t = await page.locator("body").innerText().catch(() => ""); return /couldn.t|not saved|sign in|log in|session/i.test(t) || !page.url().includes("/resume-builder/edit"); }, { timeout: 20_000 }).toBe(true);
    await info.attach("after-session-end", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(/This page couldn.t load|Application error/i.test(text), "an ended session shows a message in place, not a crash screen (#899)").toBe(false);
  });
});
