/**
 * Admin > Scholarships: a deadline note and the verified-deadline rule (QA, owner 8 Oct; test 1 is RED on main until FIX's fix).
 * Migration 0217: a VERIFIED listing may carry a deadline note only if its deadline was verified. A hand-added listing never has a verified deadline, so today it can be SAVED with
 * a note and is only refused later, at approval, with "A deadline note needs a verified-deadline date. ...". Three tests, local stack, a throwaway operator ("scholarships"
 * permission only, generated password) signing in through the real /admin/login page:
 *  1. (RED today) a hand-added listing WITH a deadline note is refused at SAVE with that same message, and no row is saved;
 *  2. a hand-added listing WITHOUT a note saves as pending and then approves (verified);
 *  3. (regression) an ingested listing WITH a verified deadline and a note still approves.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups, mustDelete } from "../tests/support/teardown";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-scholarship-deadline-note cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const MESSAGE = "A deadline note needs a verified-deadline date.";
const tag = randomUUID().slice(0, 6);
const op = { id: "", email: `e2e-sch-dn-${randomUUID()}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const prov = (k: string) => `QA DeadlineNote ${k} ${tag}`;

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}
async function fillListing(page: Page, k: string, deadlineNote: string | null) {
  await page.getByLabel("Provider", { exact: true }).fill(prov(k));
  await page.getByLabel("Programme name").fill(`QA Programme ${k} ${tag}`);
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("Funding").selectOption({ label: "Fully funded" });
  await page.getByLabel("Eligible nationalities (comma-separated)").fill("Nigerian");
  if (deadlineNote) await page.getByLabel("Deadline note — shown when there's no single date").fill(deadlineNote);
  await page.getByLabel("Official source URL").fill(`https://example.org/qa-dn-${k}-${tag}`);
  await page.getByLabel("Source name").fill(`QA Source ${k}`);
}
const rowsFor = async (k: string) => (await db!.from("scholarships").select("id, moderation_status, deadline_note").eq("provider", prov(k))).data ?? [];

test.describe("admin: scholarship deadline note vs the verified-deadline rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-schdn ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: op.roleId, permission: "scholarships" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Deadline Note", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); await db!.from("admin_audit_log").delete().like("detail->>provider", `QA DeadlineNote % ${tag}`); }],
      ["qa scholarships", async () => { await mustDelete("scholarships", db!.from("scholarships").delete().like("provider", `QA DeadlineNote % ${tag}`)); }],
      ["operator admin_users row", async () => { await mustDelete("admin_users", db!.from("admin_users").delete().eq("id", op.id)); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["admin role", async () => { await mustDelete("admin_roles", db!.from("admin_roles").delete().eq("id", op.roleId)); }],
    );
  });

  test("1. a hand-added listing WITH a deadline note is refused at save with the approval message, and nothing is saved", async ({ page }, info) => {
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await signIn(page);
    await page.goto("/admin/scholarships/new");
    await fillListing(page, "withnote", "Varies by partner institution");
    await shot("1-filled-with-a-deadline-note");
    await page.getByRole("button", { name: "Save as pending" }).click();
    await expect(page.getByText(MESSAGE), "the save must be refused with the same message approval gives").toBeVisible({ timeout: 15_000 });
    await shot("2-refused-at-save");
    expect(await rowsFor("withnote"), "a refused save must not leave a pending row behind").toHaveLength(0);
  });

  test("2. a hand-added listing WITHOUT a note saves as pending and then approves", async ({ page }, info) => {
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await signIn(page);
    await page.goto("/admin/scholarships/new");
    await fillListing(page, "nonote", null);
    await page.getByRole("button", { name: "Save as pending" }).click();
    await expect(page.getByText("Saved as pending.")).toBeVisible({ timeout: 30_000 });
    const [row] = await rowsFor("nonote");
    expect(row?.moderation_status).toBe("pending");
    await page.goto("/admin/scholarships");
    const card = page.locator("li", { has: page.getByRole("heading", { name: `QA Programme nonote ${tag}` }) });
    await card.getByRole("button", { name: "Approve & publish" }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    expect((await rowsFor("nonote"))[0]?.moderation_status).toBe("verified");
    await shot("1-approved");
  });

  test("3. (regression) an ingested listing with a verified deadline and a note still approves", async ({ page }, info) => {
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const { error } = await db!.from("scholarships").insert({ provider: prov("ingested"), program_name: `QA Programme ingested ${tag}`, official_url: `https://example.org/qa-dn-ingested-${tag}`, funding_type: "full", dedup_fingerprint: randomUUID(), deadline_note: "Varies by partner institution", deadline_verified_at: new Date().toISOString(), application_deadline: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) });
    if (error) throw new Error(`fixture ingested listing: ${error.message}`);
    await signIn(page);
    await page.goto("/admin/scholarships");
    const card = page.locator("li", { has: page.getByRole("heading", { name: `QA Programme ingested ${tag}` }) });
    await card.getByRole("button", { name: "Approve & publish" }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    expect((await rowsFor("ingested"))[0]?.moderation_status).toBe("verified");
    await shot("1-ingested-approved");
  });
});
