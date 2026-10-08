/**
 * Admin > Find a posting: the form rule (QA, owner admin scope 8 Oct). admin-postings-search.spec.ts proves one removal end to end; this one applies the rule QA uses on
 * every form: remove twice in a row (the second row's reason box starts empty), and once with a deliberate error (an empty reason is refused with a message, the posting is
 * NOT removed, and a reason typed afterwards works). The database is read back after each step (status, removed_by, removal_reason). Local stack: a throwaway operator
 * (Super Admin role, generated password) signs in through the real /admin/login page; the operators lock keeps it from colliding with the other operator specs.
 */
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { acquireOperatorsLock } from "../tests/support/operators-lock";
import { fakeSecret } from "../tests/support/fake-secret";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = SERVICE && SUPA_URL ? createClient<Database>(SUPA_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
if (process.env.CI && !admin) throw new Error("admin-postings-remove-form-rule cannot run in CI: missing service key or Supabase URL");

test("remove two postings in a row, with a deliberate empty-reason error between them", async ({ page }, info) => {
  test.setTimeout(240_000);
  if (!admin) return;
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const release = await acquireOperatorsLock(admin, "e2e-admin-postings-remove-form-rule");
  const tag = randomUUID().slice(0, 8);
  const ids: string[] = [];
  let opId = "";
  try {
    for (const n of [1, 2, 3]) {
      const { data, error } = await admin.from("job_postings").insert({ source_type: "external", title: `QA Remove Role ${n} ${tag}`, company_name: `QA Remove Co ${tag}`, external_url: `https://example.invalid/qa-remove-${n}-${tag}`, external_source: "e2e", status: "open", description: `Fixture posting ${n} for the admin postings form-rule spec.`, dedup_fingerprint: `qa-rm-${n}-${tag}` }).select("id").single();
      if (error || !data) throw new Error(`fixture posting ${n}: ${error?.message}`);
      ids.push(data.id);
    }
    const email = `qa-rm-op-${tag}@talentrah.test`;
    const password = fakeSecret("password");
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (ue || !u) throw new Error(`fixture operator: ${ue?.message}`);
    opId = u.user.id;
    const { data: role } = await admin.from("admin_roles").select("id").eq("name", "Super Admin").single();
    const { error: ae } = await admin.from("admin_users").insert({ id: opId, email, display_name: "QA postings probe", role_id: role!.id });
    if (ae) throw new Error(`fixture admin_users: ${ae.message}`);

    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(email);
    await page.locator("#admin-password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((x) => !x.pathname.startsWith("/admin/login"), { timeout: 30_000 });

    await page.goto("/admin/postings");
    await page.locator("#postings-q").fill(`QA Remove Co ${tag}`);
    await page.getByRole("button", { name: "Search" }).click();
    const row = (n: number) => page.getByTestId("postings-search-results").locator(`li:has(input[name="id"][value="${ids[n]}"])`);
    for (const n of [0, 1, 2]) await expect(row(n)).toHaveCount(1);
    await shot("1-three-results");
    const state = async (n: number) => (await admin.from("job_postings").select("status, removal_reason, removed_by").eq("id", ids[n]).single()).data;

    // Removal 1: with a reason.
    await row(0).getByRole("textbox").fill(`QA reason one ${tag}`);
    await row(0).getByRole("button", { name: "Remove from the board" }).click();
    await expect(row(0)).toHaveCount(0, { timeout: 15_000 });
    expect(await state(0)).toMatchObject({ status: "removed", removal_reason: `QA reason one ${tag}`, removed_by: opId });
    await shot("2-after-first-removal");

    // Deliberate error: an empty reason on the second row.
    await expect(row(1).getByRole("textbox")).toHaveValue("");
    await row(1).getByRole("button", { name: "Remove from the board" }).click();
    await expect(row(1).getByRole("status")).toContainText(/\S/, { timeout: 15_000 });
    expect((await state(1))?.status, "an empty reason must not remove the posting").toBe("open");
    await expect(row(1)).toHaveCount(1);
    await shot("3-empty-reason-refused");

    // Removal 2 with a reason (the refused attempt did not block it).
    await row(1).getByRole("textbox").fill(`QA reason two ${tag}`);
    await row(1).getByRole("button", { name: "Remove from the board" }).click();
    await expect(row(1)).toHaveCount(0, { timeout: 15_000 });
    expect(await state(1)).toMatchObject({ status: "removed", removal_reason: `QA reason two ${tag}`, removed_by: opId });

    // The third row's reason box is untouched by the other two.
    await expect(row(2).getByRole("textbox")).toHaveValue("");
    expect((await state(2))?.status).toBe("open");
    await shot("4-third-row-untouched");
  } finally {
    if (ids.length) {
      const { error } = await admin.from("job_postings").delete().in("id", ids);
      if (error) console.error("[qa-rm cleanup] postings:", error.message);
    }
    if (opId) {
      await admin.from("admin_audit_log").delete().eq("admin_user_id", opId);
      await admin.from("admin_users").delete().eq("id", opId);
      await admin.auth.admin.deleteUser(opId);
    }
    await release();
  }
});
