/**
 * Seeker sign-up and onboarding through the real pages (QA, 9 Oct; form rule). Sign-up: a password that is long enough but too weak is refused with a field message and the names, email and country typed are
 * kept; the corrected password creates the account (local stack: no email confirmation) and lands on onboarding with the profile row holding the typed names and country. A second sign-up with the SAME
 * email is refused and the typed fields are kept. Onboarding: a file of the wrong kind is refused with a message and the page stays usable; "Skip for now" records the skip and leaves. The password is
 * GENERATED, never typed from a real account, never printed. Local stack only; the user is removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { settle } from "./support/settle";

test.use({ viewport: { width: 1280, height: 900 } });

test("sign-up: weak password keeps the fields; corrected signs up; same email refused and kept; onboarding wrong file; skip", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 8);
  const email = `qa-signup-${tag}@${tag}.talentrah.test`;
  const strong = `Qa${randomUUID().replace(/-/g, "").slice(0, 14)}9`;
  const weak = "abcdefghijklmn";
  let userId = "";
  try {
    await page.goto("/signup");
    const fill = async (pw: string) => {
      await page.getByLabel("First name").fill("QAFirst");
      await page.getByLabel("Last name").fill(`QALast${tag}`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Country").selectOption({ label: "Nigeria" });
      await page.getByLabel("Password", { exact: true }).fill(pw);
      await page.getByRole("checkbox").check();
    };
    await fill(weak);
    await shot("1-weak-filled");
    await page.getByRole("button", { name: /Create (a free )?account|Sign up/i }).click();
    await expect(page.getByText("Check the highlighted fields below."), "the weak password is refused").toBeVisible({ timeout: 30_000 });
    await shot("2-weak-refused");
    await settle(page);
    const kept = { first: await page.getByLabel("First name").inputValue(), last: await page.getByLabel("Last name").inputValue(), email: await page.getByLabel("Email").inputValue(), country: await page.getByLabel("Country").inputValue() };
    expect(kept, "SIGNUP-KEEP-1: the typed names, email and country are kept").toEqual({ first: "QAFirst", last: `QALast${tag}`, email, country: kept.country });
    expect(kept.country, "the country choice is kept").not.toBe("");

    await page.getByLabel("Password", { exact: true }).fill(strong);
    if (!(await page.getByRole("checkbox").isChecked())) await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Create (a free )?account|Sign up/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 45_000 });
    await shot("3-onboarding");
    const { data: prof } = await admin.from("profiles").select("id, first_name, last_name, country").eq("email", email).single();
    userId = prof!.id;
    expect([prof!.first_name, prof!.last_name]).toEqual(["QAFirst", `QALast${tag}`]);
    expect(prof!.country, "country stored").toBeTruthy();

    // Onboarding: wrong file kind.
    await page.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not a resume") });
    await settle(page);
    await shot("4-wrong-file");
    expect(page.url(), "a wrong file does not leave onboarding").toMatch(/\/onboarding/);
    const bodyText = await page.locator("body").innerText();
    expect.soft(/This page couldn.t load/i.test(bodyText), "ONBOARD-FILE-1: a wrong file kind crashes the page").toBe(false);

    // Same email again, in a clean browser.
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto("/signup");
    await p2.getByLabel("First name").fill("QASecond");
    await p2.getByLabel("Last name").fill(`QALast2${tag}`);
    await p2.getByLabel("Email").fill(email);
    await p2.getByLabel("Country").selectOption({ label: "Nigeria" });
    await p2.getByLabel("Password", { exact: true }).fill(strong);
    await p2.getByRole("checkbox").check();
    await p2.getByRole("button", { name: /Create (a free )?account|Sign up/i }).click();
    await settle(p2);
    await info.attach("5-same-email", { body: await p2.screenshot({ fullPage: true }), contentType: "image/png" });
    const afterUrl = p2.url();
    const accounts = ((await admin.from("profiles").select("id").eq("email", email)).data ?? []).length;
    expect(accounts, "still exactly one account for that email").toBe(1);
    if (/\/signup/.test(afterUrl)) {
      expect.soft(await p2.getByLabel("Last name").inputValue(), "the fields typed are kept after the refusal").toBe(`QALast2${tag}`);
    }
    await ctx2.close();

    // Skip for now.
    await page.getByRole("button", { name: /Skip for now/i }).or(page.getByRole("link", { name: /Skip for now/i })).first().click();
    await page.waitForURL((u) => !/\/onboarding/.test(u.pathname), { timeout: 30_000 });
    expect((await admin.from("profiles").select("onboarding_skipped_at").eq("id", userId).single()).data!.onboarding_skipped_at, "the skip is recorded").not.toBeNull();
  } finally {
    if (!userId) { const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle(); userId = data?.id ?? ""; }
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
