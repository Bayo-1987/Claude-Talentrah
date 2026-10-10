/**
 * Admin money display (QA, 9 Oct): a payment of 2,500 naira stored as 2500 (payment_transactions.amount is whole naira, like the catalog price) must read ₦2,500 everywhere an admin sees it. (1) People
 * lookup of the payer lists the payment: the amount shown must be ₦2,500. (2) Financial health: the success/paystack total moves by exactly ₦2,500 when this payment is added (the table is global, so the
 * test reads it before and after and compares the difference). Local stack only; a throwaway operator holding "people" and "finance"; a throwaway payer and payment removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups } from "../tests/support/teardown";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-money-display cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-money-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const payer = { id: "", email: `qa-money-payer-${tag}@talentrah.test` };

test.describe("admin money display", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-money-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert([{ role_id: role.id, permission: "people" }, { role_id: role.id, permission: "finance" }]);
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const mk = async (email: string, password?: string) => { const { data, error: e } = await db!.auth.admin.createUser({ email, password, email_confirm: true }); if (e || !data) throw new Error(e?.message); return data.user.id; };
    op.id = await mk(op.email, op.password);
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Money Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    payer.id = await mk(payer.email);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["payment", async () => { const { error } = await db!.from("payment_transactions").delete().eq("user_id", payer.id); if (error) throw new Error(error.message); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["users", async () => { for (const id of [op.id, payer.id]) { const { error } = await db!.auth.admin.deleteUser(id); if (error) throw new Error(error.message); } }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("a 2,500 naira payment reads ₦2,500 in People lookup and moves the Finance total by ₦2,500", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });

    const successTotal = async () => {
      await page.goto("/admin/finance");
      await expect(page.getByRole("heading", { name: /Where the money is/ })).toBeVisible({ timeout: 30_000 });
      const rows = await page.locator("tr").allInnerTexts();
      const row = rows.find((r) => /^success\s+paystack/i.test(r.replace(/\s+/g, " ").trim()));
      if (!row) return 0;
      const m = row.replace(/\s+/g, " ").match(/₦\s?([\d,]+(?:\.\d+)?)/);
      return m ? Number(m[1].replace(/,/g, "")) : 0;
    };
    const before = await successTotal();
    const { data: pack } = await db!.from("credit_packs").select("id").limit(1).single();
    const { error } = await db!.from("payment_transactions").insert({ user_id: payer.id, rail: "paystack", amount: 2500, currency: "NGN", product_type: "credit_pack", product_id: pack!.id, paystack_reference: `qa_money_${tag}`, status: "success" });
    if (error) throw new Error(`fixture payment: ${error.message}`);
    const after = await successTotal();
    await shot("1-finance");
    expect.soft(after - before, "MONEY-FINANCE-1: Finance total moves by the amount paid, ₦2,500").toBe(2500);

    await page.goto("/admin/people");
    await page.locator("#person-term").fill(payer.email);
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByText(payer.id)).toBeVisible({ timeout: 30_000 });
    await shot("2-people");
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect.soft(text, "MONEY-PEOPLE-1: the payment reads ₦2,500 in People lookup").toMatch(/₦\s?2,500(\.00)?\b/);
  });
});
