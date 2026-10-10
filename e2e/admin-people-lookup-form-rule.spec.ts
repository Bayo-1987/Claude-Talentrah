/**
 * Admin > People (support lookup): the form rule (QA, 9 Oct). Look up two different people in a row (each shows its own record, the second starts clean), then once with a deliberate error (an
 * email nobody has): the "not found" message is shown and the term that was typed is still in the box, so a typo can be fixed rather than retyped. Local stack only; a throwaway operator holding
 * only "people" signs in through the real /admin/login page; two throwaway users are the people looked up.
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
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-people-lookup-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-people-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const people = [`qa-person-a-${tag}@talentrah.test`, `qa-person-b-${tag}@talentrah.test`].map((email) => ({ email, id: "" }));

test.describe("admin: people lookup form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-people-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "people" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA People Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    for (const p of people) {
      const { data: pu, error: peErr } = await db!.auth.admin.createUser({ email: p.email, password: fakeSecret("password"), email_confirm: true });
      if (peErr || !pu) throw new Error(`fixture person: ${peErr?.message}`);
      p.id = pu.user.id;
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["people", async () => { for (const p of people) { const { error } = await db!.auth.admin.deleteUser(p.id); if (error) throw new Error(error.message); } }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("look up two people in a row; a not-found term stays in the box", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/people");

    const term = page.locator("#person-term");
    const look = async (value: string) => { await term.fill(value); await submitAndSettle(page, () => page.getByRole("button", { name: "Look up" }).click()); };

    await look(people[0].email);
    await expect(page.getByText(people[0].id)).toBeVisible({ timeout: 30_000 });
    await shot("1-first-lookup");
    await look(people[1].email);
    await expect(page.getByText(people[1].id)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(people[0].id), "the first person is replaced, not stacked").toHaveCount(0);

    const typo = `qa-nobody-${tag}@talentrah.test`;
    await look(typo);
    await expect(page.getByText(/no (account|one|person)|not found|nothing/i).first()).toBeVisible({ timeout: 30_000 });
    await shot("3-not-found");
    await page.waitForTimeout(500);
    expect(await term.inputValue(), "the term typed must stay in the box after a not-found").toBe(typo);
  });
});
