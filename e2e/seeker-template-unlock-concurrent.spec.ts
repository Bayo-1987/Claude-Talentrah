/**
 * Seeker > Resume Builder > Unlock a premium template (QA, 9 Oct): unlocking costs credits ONCE. (1) Unlock normally: charged exactly the template's cost, one unlock row, the card becomes "Use this template".
 * (2) The same unlock pressed in two browser tabs at the same instant (a double-open, a retry on a slow connection) must still charge once; and a template unlocked in one tab must not charge again from the
 * other tab's stale page. (3) With too few credits the refusal names the cost and the balance and charges nothing. Local stack only, minted session for a throwaway user, credits granted by the test.
 */
import { test, expect, admin, grantTestCredits } from "./fixtures/authed";

/** The next Server Action POST this page makes: started BEFORE the click so the response cannot be missed. */
const actionResponse = (p: import("@playwright/test").Page) =>
  p.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: 30_000 });

test("template unlock: charged once, even from two tabs at the same instant; too few credits charges nothing", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const { data: tpls } = await admin.from("resume_templates").select("id, name, unlock_cost_credits").eq("is_premium", true).order("unlock_cost_credits").limit(2);
  expect(tpls?.length, "the catalog has premium templates").toBeGreaterThanOrEqual(2);
  const [t1, t2] = tpls!;
  const balance = async () => (await admin.from("profiles").select("credits_balance").eq("id", testUser.id).single()).data!.credits_balance as number;
  const unlocks = async (id: string) => ((await admin.from("user_template_unlocks").select("id").eq("user_id", testUser.id).eq("template_id", id)).data ?? []).length;
  const card = (p: import("@playwright/test").Page, name: string) => p.locator("div", { has: p.getByRole("heading", { name }) }).filter({ has: p.getByRole("button", { name: /Unlock for/ }) }).last();

  // (3) first: too few credits.
  const open = (p: import("@playwright/test").Page, name: string) => p.goto(`/resume-builder?q=${encodeURIComponent(name)}`);
  await open(page, t1.name);
  const poor = await balance();
  expect(poor).toBeLessThan(t1.unlock_cost_credits);
  await card(page, t1.name).getByRole("button", { name: /Unlock for/ }).click();
  await expect(page.getByText(/Not enough credits/)).toBeVisible({ timeout: 30_000 });
  expect(await balance(), "a refusal charges nothing").toBe(poor);
  expect(await unlocks(t1.id)).toBe(0);

  // (1) normal unlock.
  await grantTestCredits(testUser.id, 100);
  const start = await balance();
  await open(page, t1.name);
  await card(page, t1.name).getByRole("button", { name: /Unlock for/ }).click();
  await expect.poll(() => unlocks(t1.id), { timeout: 30_000 }).toBe(1);
  expect(await balance(), "charged exactly the cost").toBe(start - t1.unlock_cost_credits);
  await info.attach("1-unlocked", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // (2) two tabs, same instant, on several templates (a race is a matter of chance, so it is tried repeatedly).
  const { data: more } = await admin.from("resume_templates").select("id, name, unlock_cost_credits").eq("is_premium", true).neq("id", t1.id).order("unlock_cost_credits").limit(6);
  await grantTestCredits(testUser.id, 2000);
  const page2 = await page.context().newPage();
  const overcharged: string[] = [];
  const bothOk: string[] = [];
  for (const t of more!) {
    const before = await balance();
    await open(page, t.name);
    await open(page2, t.name);
    const b1 = card(page, t.name).getByRole("button", { name: /Unlock for/ });
    const b2 = card(page2, t.name).getByRole("button", { name: /Unlock for/ });
    const answered = [actionResponse(page), actionResponse(page2)];
    await Promise.all([b1.click(), b2.click()]);
    await Promise.all(answered); // both Server Actions have answered
    await Promise.all([page.waitForLoadState("networkidle"), page2.waitForLoadState("networkidle")]); // ...and both pages have re-rendered
    await expect.poll(() => unlocks(t.id), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await unlocks(t.id), "one unlock row").toBe(1);
    // Both tabs end up fine: no error text, no crash screen, and a reload shows the template unlocked.
    for (const [label, pg] of [["tab 1", page], ["tab 2", page2]] as const) {
      const txt = (await pg.locator("body").innerText()).replace(/\s+/g, " ");
      if (/Couldn.t save the unlock|This page couldn.t load/i.test(txt)) bothOk.push(`${t.name} ${label}: ${txt.match(/Couldn.t save the unlock|This page couldn.t load/i)![0]}`);
    }
    const spent = before - (await balance());
    if (spent !== t.unlock_cost_credits) overcharged.push(`${t.name}: cost ${t.unlock_cost_credits}, charged ${spent}`);
  }
  expect.soft(overcharged, "UNLOCK-RACE-1: two simultaneous unlocks of the same template must charge once").toEqual([]);
  expect.soft(bothOk, "UNLOCK-RACE-1: neither tab may show an error after the race").toEqual([]);

  // A stale tab: loaded before the unlock, pressed after it. No charge, no error; the template is unlocked.
  const t3 = (await admin.from("resume_templates").select("id, name, unlock_cost_credits").eq("is_premium", true).not("id", "in", `(${[t1.id, t2.id, ...more!.map((m) => m.id)].join(",")})`).order("unlock_cost_credits").limit(1).single()).data!;
  await open(page, t3.name); await open(page2, t3.name);
  await card(page, t3.name).getByRole("button", { name: /Unlock for/ }).click();
  await expect.poll(() => unlocks(t3.id), { timeout: 30_000 }).toBe(1);
  const afterFirst = await balance();
  const staleAnswered = actionResponse(page2);
  await card(page2, t3.name).getByRole("button", { name: /Unlock for/ }).click();
  await staleAnswered;
  await page2.waitForLoadState("networkidle");
  expect(await balance(), "a stale tab pressing Unlock after the unlock charges nothing").toBe(afterFirst);
  expect(await unlocks(t3.id)).toBe(1);
  expect((await page2.locator("body").innerText()), "...and shows no error").not.toMatch(/Couldn.t save the unlock|This page couldn.t load/i);
  await page2.reload();
  await open(page2, t3.name);
  await expect(page2.getByRole("link", { name: /Use this template/ }).first(), "reloaded: the template is unlocked").toBeVisible();
});
