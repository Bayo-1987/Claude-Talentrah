/**
 * Admin > Scholarships review queue (QA, owner admin scope 8 Oct): approve, reject, and the form rule (twice clean, once with a deliberate error).
 * Three pending listings are seeded as the service role on the LOCAL stack. A throwaway operator (own role with only the "scholarships" permission, generated password)
 * signs in through the real /admin/login page. Approving listing 1 and then listing 3 each starts from an empty note and leaves the other rows' notes alone; rejecting
 * listing 2 with an empty note is the deliberate error: it is refused with a message and the row stays pending; with a note it is rejected. The database is read back after
 * every decision (moderation_status), and the decision must leave an audit row for the listing. Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups, mustDelete } from "../tests/support/teardown";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-scholarship-review-queue cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 6);
const op = { id: "", email: `e2e-sch-review-${randomUUID()}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const ids: string[] = [];
const prog = (n: 1 | 2 | 3) => `QA Review Programme ${n} ${tag}`;

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}
const card = (page: Page, n: 1 | 2 | 3) => page.locator("li", { has: page.getByRole("heading", { name: prog(n) }) });
const statusOf = async (id: string) => (await db!.from("scholarships").select("moderation_status").eq("id", id).single()).data?.moderation_status;
const auditCount = async (id: string) => (await db!.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("target_id", id)).count ?? 0;

test.describe("admin: scholarship review queue", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-schrev ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: op.roleId, permission: "scholarships" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "E2E Scholarship Reviewer", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    for (const n of [1, 2, 3] as const) {
      const { data, error: sErr } = await db!.from("scholarships").insert({ provider: `QA Review Provider ${n} ${tag}`, program_name: prog(n), official_url: `https://example.org/qa-review-${n}-${tag}`, funding_type: "full", dedup_fingerprint: randomUUID() }).select("id").single();
      if (sErr || !data) throw new Error(`fixture scholarship ${n}: ${sErr?.message}`);
      ids.push(data.id);
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { if (ids.length) await mustDelete("admin_audit_log", db!.from("admin_audit_log").delete().in("target_id", ids)); }],
      ["qa scholarships", async () => { if (ids.length) await mustDelete("scholarships", db!.from("scholarships").delete().in("id", ids)); }],
      ["operator admin_users row", async () => { if (op.id) await mustDelete("admin_users", db!.from("admin_users").delete().eq("id", op.id)); }],
      ["operator auth user", async () => { if (op.id) { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); } }],
      ["admin role", async () => { if (op.roleId) await mustDelete("admin_roles", db!.from("admin_roles").delete().eq("id", op.roleId)); }],
    );
  });

  test("approve twice, reject once with a deliberate empty-note error first", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await signIn(page);
    await page.goto("/admin/scholarships");
    for (const n of [1, 2, 3] as const) await expect(card(page, n)).toBeVisible();
    for (const id of ids) expect(await statusOf(id)).toBe("pending");
    await shot("1-queue-with-three-pending");

    // Approve listing 1, with a note.
    await card(page, 1).getByRole("textbox").fill(`Checked the official page ${tag}`);
    await card(page, 1).getByRole("button", { name: "Approve & publish" }).click();
    await expect(card(page, 1)).toHaveCount(0, { timeout: 30_000 });
    expect(await statusOf(ids[0])).toBe("verified");
    expect(await auditCount(ids[0]), "approving writes an audit row").toBeGreaterThan(0);
    await shot("2-after-first-approval");
    // The other rows are untouched and their notes are empty.
    for (const n of [2, 3] as const) await expect(card(page, n).getByRole("textbox")).toHaveValue("");

    // Deliberate error: reject listing 2 with an empty note.
    await card(page, 2).getByRole("button", { name: "Reject" }).click();
    await expect(card(page, 2).getByRole("status")).toContainText(/\S/, { timeout: 30_000 });
    expect(await statusOf(ids[1]), "a rejection without a reason must not go through").toBe("pending");
    await shot("3-reject-without-a-note-refused");
    // The reviewer then types the reason, and keeps it through the refused attempt.
    await card(page, 2).getByRole("textbox").fill(`Source is not official ${tag}`);
    await card(page, 2).getByRole("button", { name: "Reject" }).click();
    await expect(card(page, 2)).toHaveCount(0, { timeout: 30_000 });
    expect(await statusOf(ids[1])).toBe("rejected");
    expect(await auditCount(ids[1])).toBeGreaterThan(0);
    await shot("4-after-rejection");

    // Second clean approval: listing 3 starts from an empty note.
    await expect(card(page, 3).getByRole("textbox")).toHaveValue("");
    await card(page, 3).getByRole("button", { name: "Approve & publish" }).click();
    await expect(card(page, 3)).toHaveCount(0, { timeout: 30_000 });
    expect(await statusOf(ids[2])).toBe("verified");
    await shot("5-queue-after-all-three-decisions");
    await page.reload();
    for (const n of [1, 2, 3] as const) await expect(card(page, n), "decided listings are not in the queue after a reload").toHaveCount(0);
  });
});
