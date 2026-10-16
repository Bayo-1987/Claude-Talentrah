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
import { BOUNDARY_SLACK_MS, msToWaitForSafeWindow } from "./support/rate-limit-window";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-login-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

/*
 * THE LOCKOUT SEQUENCE MUST NOT STRADDLE A RATE-LIMIT WINDOW BOUNDARY (ADMIN-LOCKOUT-WINDOW-1).
 *
 * The admin login allows 8 attempts per 900 s (`adminLogin`, src/lib/security/login-rate-limit.ts), counted in a WALL-CLOCK window
 * (`consume_anonymous_rate_limit`, migration 0117: window_start = floor(epoch / 900) * 900). If a boundary falls between the first and the ninth attempt below, the counter
 * restarts and the ninth (the right password) is allowed, so the test fails a few percent of runs for no product reason. The test therefore starts only when enough of the
 * current window is left, and otherwise waits until just after the next boundary.
 *
 * MEASURED, NOT GUESSED: the ten attempts (8 wrong, 1 right, 1 from the other address) took 4.0 to 4.98 s over five local runs, so 5 s. The margin is twice that plus 30 s
 * (the 30 s covers a slower machine and a clock a little off the database's): 40 s, which is about 4% of a 900 s window, so about 1 run in 22 waits, for at most 41 s.
 * A sliding window in the product would make this wait unnecessary; that is a separate decision (it needs a migration), so nothing under src/ or supabase/ changes here.
 */
const ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60;
const MEASURED_SEQUENCE_MS = 5_000;
const WINDOW_MARGIN_MS = 2 * MEASURED_SEQUENCE_MS + 30_000;

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
    // 180 s for the sequence as before, plus the longest possible wait for a safe window (the margin, plus the slack past the boundary): 180 + 40 + 1 = 221 s.
    test.setTimeout(180_000 + WINDOW_MARGIN_MS + BOUNDARY_SLACK_MS);
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
    const waitMs = msToWaitForSafeWindow(Date.now(), ADMIN_LOGIN_WINDOW_SECONDS, WINDOW_MARGIN_MS);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    for (let i = 0; i < 8; i++) expect(await attempt(ipA, op.wrong)).toMatch(/Incorrect email or password/);
    expect(await attempt(ipA, op.password), "locked: the right password is refused from the same address").toMatch(/Incorrect email or password/);
    expect(await attempt(ipB, op.password), "another address is not locked").toBe("in");
  });
});
