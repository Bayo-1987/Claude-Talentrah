/**
 * Admin login: the form rule and the lockout (QA, 9 Oct). Sign in with a wrong password: the generic error shows, the email that was typed is still in the box, the password is empty (never echoed
 * back). Then the right password signs in; sign out and sign in again (twice in a row, second entry starts clean). Lockout: 8 wrong attempts from one address, then the RIGHT password is refused too
 * with the same generic message (the limit is per address, 8 per 15 minutes); a different address is unaffected. The address is set with a documentation-range X-Forwarded-For (loopback is exempt from
 * the limit by design). Local stack only; a throwaway operator, a generated password; the throwaway address's counter rows are removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups } from "../tests/support/teardown";
import { submitAndSettle } from "./support/form-keeps";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-login-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const octet = () => 1 + Math.floor(Math.random() * 250);
const ipA = `203.0.113.${octet()}`;
const ipB = `198.51.100.${octet()}`;
const op = { id: "", email: `qa-login-admin-${tag}@talentrah.test`, password: fakeSecret("password"), wrong: fakeSecret("password"), roleId: "" };

test.describe("admin login form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-login-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "courses" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Login Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["rate-limit rows", async () => { const { error } = await db!.from("anonymous_rate_limits").delete().in("rate_key", [ipA, ipB]); if (error) throw new Error(error.message); }],
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["admin sessions", async () => { await db!.from("admin_sessions").delete().eq("admin_user_id", op.id); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("wrong password keeps the email and empties the password; sign in, out, in again", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ipA } });
    const page = await ctx.newPage();
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.wrong);
    await submitAndSettle(page, () => page.getByRole("button", { name: "Sign in" }).click());
    await expect(page.locator("p[role=alert]")).toContainText("Incorrect email or password", { timeout: 30_000 });
    await shot("1-wrong-password");
    await page.waitForTimeout(500);
    expect(await page.locator("#admin-password").inputValue(), "the password is never kept").toBe("");
    expect.soft(await page.locator("#admin-email").inputValue(), "LOGIN-KEEP-1: the email typed must stay after a failed sign-in").toBe(op.email);
    await page.locator("#admin-email").fill(op.email);

    for (const round of [1, 2]) {
      await page.locator("#admin-password").fill(op.password);
      await submitAndSettle(page, () => page.getByRole("button", { name: "Sign in" }).click());
      await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
      await shot(`2-signed-in-${round}`);
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
      await expect(page.locator("#admin-password"), `round ${round}: a fresh login form starts clean`).toHaveValue("");
      await page.locator("#admin-email").fill(op.email);
    }
    await ctx.close();
  });

  test("8 wrong attempts from one address lock that address out, even for the right password; another address is fine", async ({ browser }, info) => {
    test.setTimeout(180_000);
    const attempt = async (ip: string, password: string) => {
      const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
      const page = await ctx.newPage();
      await page.goto("/admin/login");
      await page.locator("#admin-email").fill(op.email);
      await page.locator("#admin-password").fill(password);
      await submitAndSettle(page, () => page.getByRole("button", { name: "Sign in" }).click());
      const outcome = await Promise.race([
        page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 }).then(() => "in" as const),
        page.locator("p[role=alert]").waitFor({ timeout: 30_000 }).then(async () => (await page.locator("p[role=alert]").innerText())),
      ]);
      if (ip === ipA && info.attachments.length < 3) info.attachments.push({ name: `attempt-${password === op.password ? "right" : "wrong"}`, contentType: "image/png", body: await page.screenshot() });
      await ctx.close();
      return outcome;
    };
    for (let i = 0; i < 8; i++) expect(await attempt(ipA, op.wrong)).toMatch(/Incorrect email or password/);
    expect(await attempt(ipA, op.password), "locked: the right password is refused from the same address").toMatch(/Incorrect email or password/);
    expect(await attempt(ipB, op.password), "another address is not locked").toBe("in");
  });
});
