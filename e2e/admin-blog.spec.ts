/**
 * The blog admin: create, edit, publish, unpublish, delete — and the audit
 * trail that has to accompany each of them.
 *
 * ── WHY THE AUDIT ASSERTIONS ARE HERE AND NOT ONLY IN A UNIT TEST ─────────
 *
 * `recordAdminAction` deliberately never throws: an audit write that failed
 * must not roll back the change it was describing. That is the right trade and
 * it has a cost — a mutation whose audit call was simply forgotten looks
 * exactly like one whose audit call failed, and both look exactly like
 * success. So the log is read back from the database after each action.
 *
 * ── UNPUBLISH IS THE PRIMARY RETIREMENT PATH ──────────────────────────────
 *
 * Asserted, not just implemented: unpublishing keeps the row, keeps
 * `published_at`, and the post can come back. Deleting is the separate,
 * quieter action. Same reasoning the job board applies to closed postings.
 */
import { test, expect, type Page } from "@playwright/test";
import { runCleanups, mustDelete } from "../tests/support/teardown";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL_ && SERVICE);
if (process.env.CI && !configured) {
  throw new Error("admin-blog spec cannot run in CI: missing Supabase URL or service-role key");
}
const db: SupabaseClient<Database> | null = configured
  ? createClient<Database>(URL_!, SERVICE!, { auth: { persistSession: false } })
  : null;

interface Fixture { id: string; email: string; password: string }
const slug = `e2e-admin-blog-${randomUUID()}`;
let operator: Fixture;
const madePosts: string[] = [];
let roleId = "";

/**
 * An operator with a REAL ROLE, not just the legacy `role` text.
 *
 * This fixture used to set `role: "super_admin"` and no `role_id`, and it
 * passed — because the blog screens only called requireAdmin(). Since 0075,
 * permissions come from `role_id` and a null one grants NOTHING by design
 * (session.ts: "an operator who can sign in and reach nothing is a visible,
 * fixable mistake"). So the fixture had zero permissions the whole time and
 * the test could not tell, which is precisely what a too-weak guard buys you.
 *
 * Gating the screens on `blog` made that visible immediately: the editor
 * stopped rendering and a `locator.fill` timed out. The guard was right and
 * the fixture was wrong.
 *
 * It gets its own role rather than reusing a builtin, so revoking a permission
 * here can never affect a real operator or another suite's expectations.
 */
async function makeOperator(): Promise<Fixture> {
  const { data: role, error: roleError } = await db!
    .from("admin_roles")
    .insert({ name: `e2e-blog ${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (roleError || !role) throw new Error(`fixture role: ${roleError?.message}`);
  roleId = role.id;

  const { error: permError } = await db!
    .from("admin_role_permissions")
    .insert({ role_id: roleId, permission: "blog" });
  if (permError) throw new Error(`fixture permission: ${permError.message}`);

  const email = `e2e-blog-admin-${randomUUID()}@talentrah.test`;
  const password = `E2E-${randomUUID()}Aa1!`;
  const { data, error } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`fixture user: ${error.message}`);
  const { error: rowError } = await db!
    .from("admin_users")
    .insert({ id: data.user.id, email, display_name: "E2E Blog Admin", role_id: roleId });
  if (rowError) throw new Error(`fixture operator: ${rowError.message}`);
  return { id: data.user.id, email, password };
}

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(operator.email);
  await page.locator("#admin-password").fill(operator.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

async function auditFor(action: string, targetId: string) {
  const { data } = await db!
    .from("admin_audit_log")
    .select("action, admin_email, target_table, target_id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data ?? [];
}

test.describe("blog admin", () => {
  test.skip(!configured, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    operator = await makeOperator();
  });

  test.afterAll(async () => {
    /*
     * Every step runs even if an earlier one fails — see runCleanups.
     *
     * This hook is the reason that helper exists. Written as a sequence of
     * throw-on-error deletes, a failure on `blog_posts` abandoned the rest and
     * left an OPERATOR behind: an admin holding real permissions, in a
     * database every other run shares. The suite reported the post failure and
     * silently created a worse one.
     *
     * Order still matters and is preserved: admin_users before admin_roles,
     * because role_id is ON DELETE RESTRICT.
     */
    await runCleanups(
      ["blog posts", async () => {
        if (madePosts.length) {
          await mustDelete("blog_posts", db!.from("blog_posts").delete().in("id", madePosts));
        }
      }],
      ["operator admin_users row", async () => {
        if (operator?.id) {
          await mustDelete("admin_users", db!.from("admin_users").delete().eq("id", operator.id));
        }
      }],
      ["operator auth user", async () => {
        if (operator?.id) {
          const { error } = await db!.auth.admin.deleteUser(operator.id);
          if (error) throw new Error(error.message);
        }
      }],
      ["admin role", async () => {
        if (roleId) {
          await mustDelete("admin_roles", db!.from("admin_roles").delete().eq("id", roleId));
        }
      }],
    );
  });

  test("the whole lifecycle, with an audit row for every step", async ({ page, request }) => {
    await signIn(page);

    // ---- CREATE -----------------------------------------------------------
    await page.goto("/admin/blog/new");
    await page.getByLabel("Title").fill("E2E lifecycle post");
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Description").fill("A post created by the admin blog end-to-end test.");
    await page.getByLabel("Author").fill("Tests");
    await page.locator("#body").fill("## First heading\n\nA paragraph with **bold** in it.");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/admin\/blog\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const id = page.url().split("/").pop()!;
    madePosts.push(id);
    expect(await auditFor("blog.create", id), "no audit row for create").toHaveLength(1);

    // Created as a DRAFT, and therefore not public.
    expect((await page.request.get(`/blog/${slug}`)).status(), "a new post was public immediately").toBe(404);

    // ---- PREVIEW, IN THE EDITOR -------------------------------------------
    await page.getByRole("button", { name: "preview" }).click();
    await expect(
      page.getByRole("heading", { name: "First heading" }),
      "the in-editor preview did not render the markdown",
    ).toBeVisible();

    // ---- EDIT --------------------------------------------------------------
    await page.getByRole("button", { name: "write" }).click();
    await page.getByLabel("Title").fill("E2E lifecycle post (edited)");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(await auditFor("blog.update", id), "no audit row for update").toHaveLength(1);

    // ---- PUBLISH -----------------------------------------------------------
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published.")).toBeVisible();
    expect(await auditFor("blog.publish", id), "no audit row for publish").toHaveLength(1);

    const live = await request.get(`/blog/${slug}`);
    expect(live.status(), "a published post is not reachable").toBe(200);
    expect((await (await request.get("/sitemap.xml")).text()).includes(slug)).toBe(true);

    // ---- UNPUBLISH — the primary retirement path ---------------------------
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Unpublished — back to draft.")).toBeVisible();
    expect(await auditFor("blog.unpublish", id), "no audit row for unpublish").toHaveLength(1);

    expect((await request.get(`/blog/${slug}`)).status(), "an unpublished post is still live").toBe(404);

    // The row survives, with its publish date intact — the whole point of
    // unpublishing rather than deleting.
    const { data: row } = await db!
      .from("blog_posts")
      .select("status, published_at")
      .eq("id", id)
      .single();
    expect(row?.status).toBe("draft");
    expect(row?.published_at, "published_at was cleared on unpublish").not.toBeNull();

    // ---- DELETE ------------------------------------------------------------
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL("**/admin/blog", { timeout: 30_000 });
    expect(await auditFor("blog.delete", id), "no audit row for delete").toHaveLength(1);

    const { count } = await db!
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    expect(count, "the post was not deleted").toBe(0);
    madePosts.length = 0;
  });

  test("a signed-out visitor cannot reach the blog admin at all", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/admin/blog");
    expect(page.url(), "the blog admin was reachable without a session").toContain("/admin/login");
  });
});
