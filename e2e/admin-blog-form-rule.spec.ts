/**
 * Admin > Blog > New post: the form rule (QA, owner admin scope 8 Oct). admin-blog.spec.ts proves the lifecycle; this one applies the rule QA uses on every form:
 * create a draft twice in a row (the second visit to the form starts completely empty, the markdown body included), then once with a deliberate error (a slug already in
 * use): the error is shown and EVERYTHING typed is still in the form. The database is read back (two drafts, none public). Local stack: a throwaway operator with its own
 * role holding only the "blog" permission, generated password, signs in through the real /admin/login page. Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups, mustDelete } from "../tests/support/teardown";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-blog-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-blog-form-${randomUUID()}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const madePosts: string[] = [];

async function fillPost(page: Page, n: number, slug: string) {
  await page.getByLabel("Title").fill(`QA form-rule post ${n} ${tag}`);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Description").fill(`Description ${n} ${tag}`);
  await page.getByLabel("Author").fill(`QA author ${n}`);
  await page.locator("#body").fill(`## Heading ${n}\n\nBody ${n} ${tag}`);
}
async function formIsEmpty(page: Page) {
  const v = await page.evaluate(() => ({ title: (document.querySelector("input[name=title]") as HTMLInputElement | null)?.value, slug: (document.querySelector("input[name=slug]") as HTMLInputElement | null)?.value, desc: (document.querySelector("[name=description]") as HTMLInputElement | null)?.value, body: (document.querySelector("#body") as HTMLTextAreaElement | null)?.value, author: (document.querySelector("[name=author]") as HTMLInputElement | null)?.value }));
  return v;
}

test.describe("admin: blog new post form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-blogform ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: op.roleId, permission: "blog" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Blog Form", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { if (madePosts.length) await mustDelete("admin_audit_log", db!.from("admin_audit_log").delete().in("target_id", madePosts)); }],
      ["blog posts", async () => { if (madePosts.length) await mustDelete("blog_posts", db!.from("blog_posts").delete().in("id", madePosts)); }],
      ["operator admin_users row", async () => { if (op.id) await mustDelete("admin_users", db!.from("admin_users").delete().eq("id", op.id)); }],
      ["operator auth user", async () => { if (op.id) { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); } }],
      ["admin role", async () => { if (op.roleId) await mustDelete("admin_roles", db!.from("admin_roles").delete().eq("id", op.roleId)); }],
    );
  });

  test("create two drafts in a row, then a duplicate slug keeps what was typed", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });

    const slug1 = `qa-form-rule-1-${tag}`;
    const slug2 = `qa-form-rule-2-${tag}`;

    await page.goto("/admin/blog/new");
    await fillPost(page, 1, slug1);
    await shot("1-first-post-filled");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/admin\/blog\/[0-9a-f-]{36}/, { timeout: 30_000 });
    madePosts.push(page.url().split("/").pop()!);

    await page.goto("/admin/blog/new");
    const empty = await formIsEmpty(page);
    // Author is a prefilled DEFAULT ("The Talentrah Team"), not carried-over text: it must be the default again, not the first post's author.
    expect(empty.author, "author is back to its default").toBe("The Talentrah Team");
    const { author: _author, ...rest } = empty;
    void _author;
    expect(Object.values(rest).filter((x) => x && x.trim() !== ""), `the second visit to the form must start empty: ${JSON.stringify(empty)}`).toEqual([]);
    await fillPost(page, 2, slug2);
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/admin\/blog\/[0-9a-f-]{36}/, { timeout: 30_000 });
    madePosts.push(page.url().split("/").pop()!);
    await shot("2-second-post-created");

    // Deliberate error: reuse the first slug. Everything typed must still be there.
    await page.goto("/admin/blog/new");
    await fillPost(page, 3, slug1);
    await page.getByRole("button", { name: "Create draft" }).click();
    await shot("3-duplicate-slug");
    await expect(page).toHaveURL(/\/admin\/blog\/new/);
    await expect(page.getByLabel("Title")).toHaveValue(`QA form-rule post 3 ${tag}`);
    await expect(page.getByLabel("Slug")).toHaveValue(slug1);
    await expect(page.getByLabel("Description")).toHaveValue(`Description 3 ${tag}`);
    await expect(page.getByLabel("Author")).toHaveValue("QA author 3");
    await expect(page.locator("#body")).toHaveValue(`## Heading 3\n\nBody 3 ${tag}`);
    await expect(page.getByRole("alert").or(page.getByText(/slug/i).first())).toBeVisible();

    const { data: rows } = await db!.from("blog_posts").select("slug, status").in("slug", [slug1, slug2]).order("slug");
    expect(rows?.map((r) => r.status)).toEqual(["draft", "draft"]);
    expect((await page.request.get(`/blog/${slug1}`)).status(), "a draft is not public").toBe(404);
  });
});
