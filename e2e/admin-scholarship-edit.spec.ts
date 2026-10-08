/**
 * Admin > Scholarships > EDIT A LISTING (owner row 8 Oct, written RED FIRST for when S1 builds the UI; S1 adapts the selectors in the CONFIG block if its markup differs).
 * Local stack only. A throwaway operator ("scholarships" permission only, generated password) signs in through the real /admin/login page; listings are seeded as the service role.
 *  E1 edit a PENDING listing: the form is pre-filled with every field (Other eligibility notes included); changing them saves, the listing STAYS pending, same row (no duplicate);
 *  E2 edit a PUBLISHED listing: the warning "Saving will take this off the site until it's re-approved" is shown BEFORE saving; saving returns it to pending and writes an
 *     audit row naming the operator;
 *  E3 a rule approval would refuse (a deadline note on a listing with no verified deadline) is refused AT SAVE with the same message; nothing changes;
 *  R1 (regression, should already pass) re-submitting a hand-added listing by the same provider and programme name keeps ONE row;
 *  R2 (regression) editing one listing leaves an ingested pending listing untouched (uses the Edit button, so it is red until the UI exists; its premise holds today).
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups, mustDelete } from "../tests/support/teardown";

// ---- CONFIG: what the spec assumes about the not-yet-built UI. Adapt in one place. ----
const EDIT_BUTTON = /^Edit$/;
const SAVE_EDIT_BUTTON = /^Save changes$/;
const PUBLISHED_WARNING = /Saving will take this off the site until it.s re-approved/;
const NOTE_MESSAGE = "A deadline note needs a verified-deadline date.";
const LISTS_PUBLISHED_AT = "/admin/scholarships/published"; // where a published listing is found and edited from: its own page, because the review queue must lose a card once it is approved
// ---------------------------------------------------------------------------------------

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-scholarship-edit cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 6);
const op = { id: "", email: `e2e-sch-edit-${randomUUID()}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const ids: string[] = [];
const prov = (k: string) => `QA Edit ${k} ${tag}`;
const prog = (k: string) => `QA Edit Programme ${k} ${tag}`;

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}
async function seed(k: string, over: Record<string, unknown> = {}) {
  const { data, error } = await db!.from("scholarships").insert({ provider: prov(k), program_name: prog(k), official_url: `https://example.org/qa-edit-${k}-${tag}`, funding_type: "full", dedup_fingerprint: randomUUID(), eligibility_other: `Original note ${k} ${tag}: first-class degree`, host_institution: `Original host ${k}`, ...over } as never).select("id").single();
  if (error || !data) throw new Error(`fixture ${k}: ${error?.message}`);
  ids.push((data as { id: string }).id);
  return (data as { id: string }).id;
}
const row = async (id: string) => (await db!.from("scholarships").select("id, moderation_status, eligibility_other, host_institution, deadline_note, program_name").eq("id", id).single()).data;
const card = (page: Page, k: string) => page.locator("li", { has: page.getByRole("heading", { name: prog(k) }) });
const editor = (page: Page) => page.getByRole("textbox", { name: /Other eligibility notes/ });

test.describe("admin: edit a scholarship listing", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-schedit ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: op.roleId, permission: "scholarships" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Scholarship Editor", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); if (ids.length) await db!.from("admin_audit_log").delete().in("target_id", ids); }],
      ["qa scholarships", async () => { await mustDelete("scholarships", db!.from("scholarships").delete().like("provider", `QA Edit % ${tag}`)); }],
      ["operator admin_users row", async () => { await mustDelete("admin_users", db!.from("admin_users").delete().eq("id", op.id)); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["admin role", async () => { await mustDelete("admin_roles", db!.from("admin_roles").delete().eq("id", op.roleId)); }],
    );
  });

  test("E1 edit a pending listing: pre-filled, fields change, stays pending, one row", async ({ page }, info) => {
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const id = await seed("e1");
    await signIn(page);
    await page.goto("/admin/scholarships");
    await card(page, "e1").getByRole("button", { name: EDIT_BUTTON }).or(card(page, "e1").getByRole("link", { name: EDIT_BUTTON })).click();
    await expect(page.getByLabel("Host institution (optional)")).toHaveValue("Original host e1");
    await expect(editor(page)).toContainText(`Original note e1 ${tag}`);
    await shot("1-edit-form-prefilled");
    await page.getByLabel("Host institution (optional)").fill("Edited host e1");
    await editor(page).click();
    await page.keyboard.press("End");
    await editor(page).pressSequentially(` EDITED ${tag}`);
    await page.getByRole("button", { name: SAVE_EDIT_BUTTON }).click();
    await expect.poll(async () => (await row(id))?.host_institution, { timeout: 30_000 }).toBe("Edited host e1");
    const after = await row(id);
    expect(after?.moderation_status, "an edited pending listing stays pending").toBe("pending");
    expect(after?.eligibility_other).toContain(`EDITED ${tag}`);
    expect((await db!.from("scholarships").select("id").eq("provider", prov("e1"))).data, "no duplicate row").toHaveLength(1);
    await shot("2-after-save");
  });

  test("E2 edit a published listing: warning before saving, returns to pending, audit row for the operator", async ({ page }, info) => {
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const id = await seed("e2", { moderation_status: "verified" });
    await signIn(page);
    await page.goto(LISTS_PUBLISHED_AT);
    await card(page, "e2").getByRole("button", { name: EDIT_BUTTON }).or(card(page, "e2").getByRole("link", { name: EDIT_BUTTON })).click();
    await expect(page.getByText(PUBLISHED_WARNING), "the warning must show BEFORE saving").toBeVisible();
    await shot("1-warning-shown");
    await page.getByLabel("Host institution (optional)").fill("Edited host e2");
    await page.getByRole("button", { name: SAVE_EDIT_BUTTON }).click();
    await expect.poll(async () => (await row(id))?.moderation_status, { timeout: 30_000 }).toBe("pending");
    expect((await row(id))?.host_institution).toBe("Edited host e2");
    const { data: audits } = await db!.from("admin_audit_log").select("admin_user_id, admin_email, action").eq("target_id", id);
    expect(audits?.some((a) => a.admin_email === op.email || a.admin_user_id === op.id), "an audit row names the operator").toBe(true);
  });

  test("E3 a deadline note on a listing with no verified deadline is refused AT SAVE with the approval message", async ({ page }) => {
    const id = await seed("e3");
    await signIn(page);
    await page.goto("/admin/scholarships");
    await card(page, "e3").getByRole("button", { name: EDIT_BUTTON }).or(card(page, "e3").getByRole("link", { name: EDIT_BUTTON })).click();
    await page.getByLabel("Deadline note — shown when there's no single date").fill("Varies by partner institution");
    await page.getByRole("button", { name: SAVE_EDIT_BUTTON }).click();
    await expect(page.getByText(NOTE_MESSAGE)).toBeVisible({ timeout: 15_000 });
    expect((await row(id))?.deadline_note, "nothing was saved").toBeNull();
  });

  test("R1 (regression) re-submitting a hand-added listing by the same provider and programme name keeps ONE row", async ({ page }) => {
    await signIn(page);
    for (let i = 0; i < 2; i++) {
      await page.goto("/admin/scholarships/new");
      await page.getByLabel("Provider", { exact: true }).fill(prov("r1"));
      await page.getByLabel("Programme name").fill(prog("r1"));
      await page.getByRole("checkbox").first().check();
      await page.getByLabel("Funding").selectOption({ label: "Fully funded" });
      await page.getByLabel("Eligible nationalities (comma-separated)").fill("Nigerian");
      await page.getByLabel("Official source URL").fill(`https://example.org/qa-edit-r1-${tag}`);
      await page.getByLabel("Source name").fill("QA Source r1");
      await page.getByRole("button", { name: "Save as pending" }).click();
      await expect(page.getByText("Saved as pending.")).toBeVisible({ timeout: 30_000 });
    }
    expect((await db!.from("scholarships").select("id").eq("provider", prov("r1"))).data, "same name twice keeps one row").toHaveLength(1);
  });

  test("R2 (regression, needs the Edit button) an ingested pending listing is untouched by editing another listing", async ({ page }) => {
    const ingested = await seed("r2-ingested", { deadline_note: "Varies by partner institution", deadline_verified_at: new Date().toISOString() });
    const edited = await seed("r2-edited");
    const before = JSON.stringify(await row(ingested));
    await signIn(page);
    await page.goto("/admin/scholarships");
    await card(page, "r2-edited").getByRole("button", { name: EDIT_BUTTON }).or(card(page, "r2-edited").getByRole("link", { name: EDIT_BUTTON })).click();
    await page.getByLabel("Host institution (optional)").fill("Edited host r2");
    await page.getByRole("button", { name: SAVE_EDIT_BUTTON }).click();
    await expect.poll(async () => (await row(edited))?.host_institution, { timeout: 30_000 }).toBe("Edited host r2");
    expect(JSON.stringify(await row(ingested)), "the ingested listing is unchanged").toBe(before);
  });
});
