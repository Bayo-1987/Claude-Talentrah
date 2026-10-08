/**
 * Admin > Add a scholarship: the form must start clean after every save (QA, owner 8 Oct; RED on main until FIX's reset fix).
 *
 * The form rule QA applies to every form: complete it twice in a row, then once with a deliberate error. The second entry must start clean, the error must keep
 * what was typed. Here: save listing A with "Other eligibility notes" (the MinimalRichEditor) filled in; EVERY field must be empty afterwards, the editor included;
 * save listing B with a different note; both listings appear pending and neither carries the other's text; then one deliberate error (an invalid source URL)
 * keeps everything typed, the editor included. Local stack only: a throwaway operator (own role with the "scholarships" permission, generated password, no real
 * account) signs in through the real /admin/login page. Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups, mustDelete } from "../tests/support/teardown";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-scholarship-new cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 6);
const op = { id: "", email: `e2e-sch-admin-${randomUUID()}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const provider = (n: "A" | "B") => `QA Admin Provider ${n} ${tag}`;

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

async function fillListing(page: Page, n: "A" | "B", note: string) {
  await page.getByLabel("Provider", { exact: true }).fill(provider(n));
  await page.getByLabel("Programme name").fill(`QA Programme ${n} ${tag}`);
  await page.getByLabel("Host institution (optional)").fill(`QA Host ${n}`);
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("Funding").selectOption({ label: "Fully funded" });
  await page.getByLabel("What it covers (comma-separated)").fill(`tuition ${n}`);
  await page.getByLabel("Field tags (comma-separated)").fill(`tag${n}`);
  await page.getByLabel("Eligible nationalities (comma-separated)").fill("Nigerian");
  await page.getByLabel("Prior degree required (optional)").fill(`BSc ${n}`);
  await page.getByLabel("Age requirement (optional)").fill("under 35");
  await page.getByRole("textbox", { name: /Other eligibility notes/ }).click();
  await page.getByRole("textbox", { name: /Other eligibility notes/ }).pressSequentially(note);
  await page.getByLabel("Deadline note — shown when there's no single date").fill(`Rolling ${n}`);
  await page.getByLabel("Official source URL").fill(`https://example.org/qa-${n.toLowerCase()}-${tag}`);
  await page.getByLabel("Source name").fill(`QA Source ${n}`);
}

async function everyFieldIsEmpty(page: Page) {
  const values = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const e of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("form input[type=text], form input:not([type]), form input[type=url], form textarea")) {
      if (e.name) out[e.name] = e.value;
    }
    const editor = document.querySelector<HTMLElement>("[contenteditable=true]");
    out["(editor) eligibilityOther"] = editor?.innerText.trim() ?? "";
    return out;
  });
  const nonEmpty = Object.entries(values).filter(([, v]) => v.trim() !== "");
  expect(nonEmpty, `after a save every field must be empty; carried over: ${JSON.stringify(nonEmpty)}`).toEqual([]);
}

test.describe("admin: add a scholarship twice, then with an error", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-sch ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: op.roleId, permission: "scholarships" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "E2E Scholarship Admin", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["qa scholarships", async () => { await mustDelete("scholarships", db!.from("scholarships").delete().like("provider", `QA Admin Provider % ${tag}`)); }],
      ["operator admin_users row", async () => { if (op.id) await mustDelete("admin_users", db!.from("admin_users").delete().eq("id", op.id)); }],
      ["operator auth user", async () => { if (op.id) { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); } }],
      ["admin role", async () => { if (op.roleId) await mustDelete("admin_roles", db!.from("admin_roles").delete().eq("id", op.roleId)); }],
    );
  });

  test("save, the form is empty (editor included), save a second listing, both pending, no carried-over text; an error keeps what was typed", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await signIn(page);
    await page.goto("/admin/scholarships/new");

    await fillListing(page, "A", `Note A ${tag}: must be a first-class graduate`);
    await shot("1-listing-A-filled");
    await page.getByRole("button", { name: "Save as pending" }).click();
    await expect(page.getByText("Saved as pending.")).toBeVisible({ timeout: 30_000 });
    await shot("2-after-first-save");
    await everyFieldIsEmpty(page);

    await fillListing(page, "B", `Note B ${tag}: open to final-year students`);
    await page.getByRole("button", { name: "Save as pending" }).click();
    await expect(page.getByText(provider("B"))).toBeVisible({ timeout: 30_000 });
    await shot("3-after-second-save");
    await everyFieldIsEmpty(page);

    const { data: rows } = await db!.from("scholarships").select("provider, moderation_status, eligibility_other").like("provider", `QA Admin Provider % ${tag}`).order("provider");
    expect(rows?.map((r) => r.provider)).toEqual([provider("A"), provider("B")]);
    for (const r of rows ?? []) expect(r.moderation_status).toBe("pending");
    const other = (r: { eligibility_other: string | null } | undefined) => r?.eligibility_other ?? "";
    expect(other(rows?.[0])).toContain(`Note A ${tag}`);
    expect(other(rows?.[0]), "listing A carries only its own note").not.toContain(`Note B ${tag}`);
    expect(other(rows?.[1])).toContain(`Note B ${tag}`);
    expect(other(rows?.[1]), "listing B carries no text from A").not.toContain(`Note A ${tag}`);

    await fillListing(page, "A", `Error note ${tag}: this entry will fail`);
    await page.getByLabel("Official source URL").fill("not a url");
    await page.getByRole("button", { name: "Save as pending" }).click();
    await shot("4-deliberate-error");
    await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(provider("A"));
    await expect(page.getByLabel("Official source URL")).toHaveValue("not a url");
    await expect(page.getByRole("textbox", { name: /Other eligibility notes/ })).toContainText(`Error note ${tag}`);
  });
});
