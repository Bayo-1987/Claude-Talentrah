/**
 * Admin > Operations > Mark refunded: the form rule (QA, 9 Oct). Mark two payments refunded in a row (a message each time, the row leaves the list, the database agrees), then once with a deliberate
 * error (the third was resolved by someone else after the page loaded): the page says so and changes nothing. Local stack only; a throwaway operator holding only "operations" signs in through the
 * real /admin/login page; three throwaway mentor sessions in payment_needs_refund. No Paystack call is made (the action only marks the session).
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
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-ops-refund-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-ops-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
let mentorId = "", menteeId = "";
const sessions: string[] = [];
const slots: string[] = [];

test.describe("admin: ops mark refunded form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-ops-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "operations" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const mk = async (email: string, password: string) => {
      const { data, error: e } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
      if (e || !data) throw new Error(`fixture user: ${e?.message}`);
      return data.user.id;
    };
    op.id = await mk(op.email, op.password);
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Ops Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    mentorId = await mk(`qa-ops-mentor-${tag}@talentrah.test`, fakeSecret("password"));
    menteeId = await mk(`qa-ops-mentee-${tag}@talentrah.test`, fakeSecret("password"));
    const { error: mpErr } = await db!.from("mentor_profiles").insert({ user_id: mentorId, status: "approved", bio: "qa mentor" });
    if (mpErr) throw new Error(`fixture mentor: ${mpErr.message}`);
    for (let i = 0; i < 3; i++) {
      const start = new Date(Date.now() - (i + 2) * 86_400_000).toISOString();
      const end = new Date(Date.now() - (i + 2) * 86_400_000 + 1_800_000).toISOString();
      const { data: slot, error: sErr } = await db!.from("mentor_availability_slots").insert({ mentor_id: mentorId, start_at: start, end_at: end, is_booked: false }).select("id").single();
      if (sErr || !slot) throw new Error(`fixture slot: ${sErr?.message}`);
      slots.push(slot.id);
      const { data: s, error: seErr } = await db!.from("mentorship_sessions").insert({ mentor_id: mentorId, mentee_id: menteeId, availability_slot_id: slot.id, session_type: "quick_question", scheduled_start: start, scheduled_end: end, status: "payment_needs_refund", price_ngn: 10_000, platform_commission_ngn: 1_500, mentor_payout_ngn: 8_500 }).select("id").single();
      if (seErr || !s) throw new Error(`fixture session: ${seErr?.message}`);
      sessions.push(s.id);
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["sessions", async () => { const { error } = await db!.from("mentorship_sessions").delete().in("id", sessions); if (error) throw new Error(error.message); }],
      ["slots", async () => { const { error } = await db!.from("mentor_availability_slots").delete().in("id", slots); if (error) throw new Error(error.message); }],
      ["mentor profile", async () => { await db!.from("mentor_profiles").delete().eq("user_id", mentorId); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["users", async () => { for (const id of [op.id, mentorId, menteeId]) { const { error } = await db!.auth.admin.deleteUser(id); if (error) throw new Error(error.message); } }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("mark two refunded in a row; an already-resolved one says so and changes nothing", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/ops");

    const row = (id: string) => page.locator("li", { hasText: id }).filter({ has: page.getByRole("button", { name: "Mark refunded" }) }).last();
    const statusOf = async (id: string) => (await db!.from("mentorship_sessions").select("status").eq("id", id).single()).data?.status;
    const msg = () => page.locator("p[role=status], p[role=alert]").filter({ hasText: /\S/ }).first();

    await submitAndSettle(page, () => row(sessions[0]).getByRole("button", { name: "Mark refunded" }).click());
    await expect(msg()).toContainText("Marked refunded", { timeout: 30_000 });
    await shot("1-first-marked");
    expect(await statusOf(sessions[0])).toBe("refunded");
    await expect(page.getByText(sessions[0]), "the row has left the list").toHaveCount(0);
    await submitAndSettle(page, () => row(sessions[1]).getByRole("button", { name: "Mark refunded" }).click());
    await expect.poll(() => statusOf(sessions[1]), { timeout: 30_000 }).toBe("refunded");
    await expect(msg()).toContainText("Marked refunded");
    await expect(page.getByText(sessions[1]), "the second row has left the list").toHaveCount(0);

    // Deliberate error: resolved by someone else after the page loaded.
    await db!.from("mentorship_sessions").update({ status: "refunded" }).eq("id", sessions[2]);
    await submitAndSettle(page, () => row(sessions[2]).getByRole("button", { name: "Mark refunded" }).click());
    await shot("3-already-resolved");
    // REFUND-SILENT-1: this is the LAST row, so the list (and the one message it owns) is unmounted with it: nothing on the page says what happened.
    await expect(msg()).toContainText(/already resolved/i, { timeout: 30_000 });
    expect(await statusOf(sessions[2])).toBe("refunded");
  });
});
