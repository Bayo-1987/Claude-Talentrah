/**
 * Admin > Blog > a post's Publish / Unpublish controls: the form rule (QA, 9 Oct). Publish, unpublish, publish again in a row: each shows its own message and the database follows. Then once with a
 * deliberate error (the post was deleted by someone else after the page loaded): the refusal is shown, not a stale earlier message. Local stack only; a throwaway operator holding only "blog"
 * signs in through the real /admin/login page; one throwaway post.
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
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-blog-status-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-blogst-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
let postId = "";

test.describe("admin: blog status controls form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-blogst-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "blog" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Blog Status Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    const { data: p, error: bErr } = await db!.from("blog_posts").insert({ slug: `qa-status-${tag}`, title: `QA status post ${tag}`, description: "QA throwaway post", author: "QA", body: "<p>QA body</p>", status: "draft" }).select("id").single();
    if (bErr || !p) throw new Error(`fixture post: ${bErr?.message}`);
    postId = p.id;
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["post", async () => { const { error } = await db!.from("blog_posts").delete().eq("slug", `qa-status-${tag}`); if (error) throw new Error(error.message); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("publish, unpublish, publish; a deleted post is refused with its own message", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto(`/admin/blog/${postId}`);

    const status = async () => (await db!.from("blog_posts").select("status").eq("id", postId).maybeSingle()).data?.status;
    const msg = (shown: RegExp) => page.getByText(shown).first();
    const press = async (name: string, shown: RegExp, now: string) => {
      await submitAndSettle(page, () => page.getByRole("button", { name, exact: true }).click());
      await expect(msg(shown)).toBeVisible({ timeout: 30_000 });
      expect(await status()).toBe(now);
    };
    await press("Publish", /Published\./, "published");
    await shot("1-published");
    await press("Unpublish", /Unpublished/, "draft");
    await press("Publish", /Published\./, "published");

    await db!.from("blog_posts").delete().eq("id", postId);
    await submitAndSettle(page, () => page.getByRole("button", { name: "Unpublish", exact: true }).click());
    await shot("3-deleted-elsewhere");
    await expect(msg(/no longer exists/i), "the refusal replaces the earlier 'Published.'").toBeVisible({ timeout: 30_000 });
  });
});
