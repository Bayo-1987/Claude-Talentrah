/**
 * Admin > Employer verification (DecisionForm, shared by the other review queues): the form rule (QA, 9 Oct). Verify two organisations in a row with a note each (success message each time, the
 * second note box starts clean), then once with a deliberate error (the organisation was verified by someone else after the page loaded): the error is shown, and the note typed is still there.
 * Local stack only; a throwaway operator holding only "employer_verification" signs in through the real /admin/login page; throwaway organisations. The database is read back.
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
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-employer-verification-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-ver-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const orgs = ["A", "B", "C"].map((k) => ({ k, id: "", name: `QAVER Org ${k} ${tag}` }));

test.describe("admin: employer verification form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-ver-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "employer_verification" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Verification Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    for (const o of orgs) {
      const { data, error: oErr } = await db!.from("organizations").insert({ name: o.name, created_by: op.id, cac_number: `RC${tag}${o.k}`, cac_business_name: `${o.name} Ltd` }).select("id").single();
      if (oErr || !data) throw new Error(`fixture org: ${oErr?.message}`);
      o.id = data.id;
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["organisations", async () => { const { error } = await db!.from("organizations").delete().in("id", orgs.map((o) => o.id).filter(Boolean)); if (error) throw new Error(error.message); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("verify two in a row; an already-decided organisation keeps the typed note", async ({ page }, info) => {
    test.setTimeout(150_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/employer-verification");

    const card = (o: { name: string }) => page.locator("li", { hasText: o.name }).filter({ has: page.getByRole("button", { name: "Verify by CAC" }) }).last();
    const noteOf = (o: { id: string }) => page.locator(`[id="${o.id}-note"]`);
    const [a, b, c] = orgs;

    // Two in a row; each with a note, each shows its message; the next note box is empty.
    await expect(noteOf(b)).toHaveValue("");
    await noteOf(a).fill("QA note for A");
    await submitAndSettle(page, () => card(a).getByRole("button", { name: "Verify by CAC" }).click());
    await expect.poll(async () => (await db!.from("organizations").select("verified").eq("id", a.id).single()).data?.verified, { timeout: 30_000 }).toBe(true);
    await settle(page);
    // VER-SILENT-1: the row leaves the queue when it is verified and takes its own confirmation with it, so nothing on the page says it worked.
    await expect(page.getByRole("status").filter({ hasText: "Verified" }).first(), "a confirmation for A is announced after its row left the queue (#914)").toBeVisible({ timeout: 10_000 });
    await shot("1-first-verified");
    await expect(noteOf(b)).toHaveValue("");
    await noteOf(b).fill("QA note for B");
    await submitAndSettle(page, () => card(b).getByRole("button", { name: "Verify by CAC" }).click());
    await expect.poll(async () => (await db!.from("organizations").select("verified").eq("id", b.id).single()).data?.verified, { timeout: 30_000 }).toBe(true);
    await settle(page);
    // VER-SILENT-1: the row leaves the queue when it is verified and takes its own confirmation with it, so nothing on the page says it worked.
    await expect(page.getByRole("status").filter({ hasText: "Verified" }).first(), "a confirmation for B is announced after its row left the queue (#914)").toBeVisible({ timeout: 10_000 });

    // Deliberate error 1: reject without a reason.
    await submitAndSettle(page, () => card(c).getByRole("button", { name: "Reject" }).click());
    await expect(card(c).getByRole("status")).toContainText("A rejection needs a reason", { timeout: 30_000 });

    // Deliberate error 2: somebody else verifies it first.
    await noteOf(c).fill("QA note typed before the race");
    await db!.from("organizations").update({ verified: true, cac_confirmed_at: new Date().toISOString(), cac_confirmed_by: op.id }).eq("id", c.id);
    await submitAndSettle(page, () => card(c).getByRole("button", { name: "Verify by CAC" }).click());
    await expect(card(c).getByRole("status")).toContainText("Already decided", { timeout: 30_000 });
    await shot("3-already-decided");
    await settle(page);
    expect(await noteOf(c).inputValue(), "the error must keep the note that was typed").toBe("QA note typed before the race");
  });
});
