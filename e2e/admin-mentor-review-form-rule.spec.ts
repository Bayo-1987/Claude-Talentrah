/**
 * Admin > Mentor applications (DecisionForm with the rich-text note): the form rule (QA, 9 Oct). Approve two applicants in a row with a note each, then once with a deliberate error (the third was
 * decided by someone else after the page loaded): the error is shown and the note typed in the editor is still there. Local stack only; a throwaway operator holding only "mentor_review" signs in
 * through the real /admin/login page; three throwaway applicants. The database is read back.
 */
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups } from "../tests/support/teardown";
import { submitAndSettle } from "./support/form-keeps";
import { settle } from "./support/settle";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-mentor-review-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-mrev-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const applicants = ["A", "B", "C"].map((k) => ({ k, id: "", name: `QA Applicant ${k} ${tag}` }));

test.describe("admin: mentor review form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-mrev-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "mentor_review" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const mk = async (email: string, password: string) => {
      const { data, error: e } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
      if (e || !data) throw new Error(`fixture user: ${e?.message}`);
      return data.user.id;
    };
    op.id = await mk(op.email, op.password);
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Mentor Review Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    for (const a of applicants) {
      a.id = await mk(`qa-mrev-${a.k.toLowerCase()}-${tag}@talentrah.test`, fakeSecret("password"));
      const { error: mErr } = await db!.from("mentor_profiles").insert({ user_id: a.id, status: "pending", display_name: a.name, bio: "QA throwaway applicant", years_experience: 5, base_price_ngn: 10_000 });
      if (mErr) throw new Error(`fixture applicant: ${mErr.message}`);
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["mentor profiles", async () => { await db!.from("mentor_profiles").delete().in("user_id", applicants.map((a) => a.id)); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["users", async () => { for (const id of [op.id, ...applicants.map((a) => a.id)]) { const { error } = await db!.auth.admin.deleteUser(id); if (error) throw new Error(error.message); } }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("approve two in a row; an already-decided applicant keeps the typed note", async ({ page }, info) => {
    test.setTimeout(150_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/mentor-review");

    const card = (a: { name: string }) => page.locator("li", { hasText: a.name }).filter({ has: page.getByRole("button", { name: "Approve as mentor" }) }).last();
    const editor = (a: { name: string }) => card(a).locator('[contenteditable="true"]').first();
    const statusOf = async (id: string) => (await db!.from("mentor_profiles").select("status").eq("user_id", id).single()).data?.status;
    const [a, b, c] = applicants;

    await editor(a).click();
    await page.keyboard.type("QA note for A");
    await submitAndSettle(page, () => card(a).getByRole("button", { name: "Approve as mentor" }).click());
    await expect.poll(() => statusOf(a.id), { timeout: 30_000 }).toBe("approved");
    await shot("1-first-approved");
    // VER-SILENT-1 class: look for ANY confirmation on the page after the row has left the queue.
    await expect(page.locator("p[role=status]").filter({ hasText: /\S/ }).first(), "a confirmation for A is on the page after its row left the queue").toBeVisible({ timeout: 15_000 });

    await expect(editor(b)).toHaveText("");
    await editor(b).click();
    await page.keyboard.type("QA note for B");
    await submitAndSettle(page, () => card(b).getByRole("button", { name: "Approve as mentor" }).click());
    await expect.poll(() => statusOf(b.id), { timeout: 30_000 }).toBe("approved");
    await settle(page);

    // Deliberate error: decided by someone else after the page loaded.
    await editor(c).click();
    await page.keyboard.type("QA note typed before the race");
    await db!.from("mentor_profiles").update({ status: "approved" }).eq("user_id", c.id);
    await submitAndSettle(page, () => card(c).getByRole("button", { name: "Approve as mentor" }).click());
    await shot("3-already-decided");
    await expect(card(c).locator("p[role=status]")).toContainText(/already|decided|reload/i, { timeout: 30_000 });
    await settle(page);
    expect(await editor(c).innerText(), "the error must keep the note that was typed").toContain("QA note typed before the race");
  });
});
