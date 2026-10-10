/**
 * Seeker billing with NO payment provider configured (QA, 9 Oct; there is no fake Paystack: the client's base URL is a constant and fulfilment verifies against the live API, so a real purchase cannot be
 * driven locally). What CAN be driven: /billing shows the catalog (two credit packs, three passes, the prices in src/lib/billing/catalog.ts' database rows), warns that payments are not configured,
 * and pressing Buy on a pack and on a pass each lands back on /billing with the "couldn't start" message, records the attempt as FAILED (never pending, so nothing can be fulfilled later by mistake),
 * and leaves the credit balance and the passes untouched. Pressing Buy a second time does the same, with no duplicate pending row. Needs the app started WITHOUT PAYSTACK_SECRET_KEY (a local stack
 * never has it); skips itself otherwise. Local stack only, minted session for a throwaway user.
 */
import { test, expect, admin } from "./fixtures/authed";

test("billing without a provider: catalog shown, Buy fails cleanly, attempts are recorded failed, nothing is granted", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const txs = async () => (await admin.from("payment_transactions").select("status, product_type, amount").eq("user_id", testUser.id)).data ?? [];
  const balance = async () => (await admin.from("profiles").select("credits_balance").eq("id", testUser.id).single()).data?.credits_balance;
  const startBalance = await balance();

  await page.goto("/billing");
  await shot("1-billing");
  test.skip(!(await page.getByText(/Payments aren.t configured yet in this environment/).count()), "a payment provider is configured on this app; this spec is for the unconfigured case");

  const { data: packs } = await admin.from("credit_packs").select("name, credits, price_ngn").eq("is_active", true).order("price_ngn");
  const { data: passes } = await admin.from("passes").select("name, price_ngn").eq("is_active", true).order("price_ngn");
  expect(packs?.length, "two live credit packs (Starter, Plus)").toBe(2);
  expect(passes?.length, "three live passes").toBe(3);
  for (const p of packs!) {
    await expect(page.getByRole("button", { name: new RegExp(`${p.name} · ${p.credits}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`${p.name} · ${p.credits}`) })).toContainText(p.price_ngn.toLocaleString("en-NG"));
  }
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toHaveCount(3);

  const attempts: Array<[string, () => Promise<void>]> = [
    ["pack", async () => { await page.getByRole("button", { name: new RegExp(`${packs![0].name} · ${packs![0].credits}`) }).click(); }],
    ["pass", async () => { await page.getByRole("button", { name: "Buy", exact: true }).first().click(); }],
    ["pack again", async () => { await page.getByRole("button", { name: new RegExp(`${packs![0].name} · ${packs![0].credits}`) }).click(); }],
  ];
  let expected = 0;
  for (const [label, press] of attempts) {
    await press();
    await page.waitForURL(/\/billing\?error=payments_unavailable/, { timeout: 30_000 });
    await expect(page.getByText(/That purchase couldn.t start/)).toBeVisible();
    expected += 1;
    await expect.poll(async () => (await txs()).length, { timeout: 15_000, message: label }).toBe(expected);
    if (label === "pack") await shot("2-pack-refused");
    const rows = await txs();
    expect(rows.every((r) => r.status === "failed"), `${label}: every attempt is recorded failed, none pending: ${JSON.stringify(rows.map((r) => r.status))}`).toBe(true);
    expect(await balance(), `${label}: no credits granted`).toBe(startBalance);
    await page.goto("/billing");
  }
  const { data: userPasses } = await admin.from("user_passes").select("id").eq("user_id", testUser.id);
  expect(userPasses ?? [], "no pass granted").toHaveLength(0);
});
