import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";

/**
 * Server Actions enforce permissions themselves, not by inheriting the page's.
 *
 * e2e/admin-permissions.spec.ts proves an operator is bounced from a PAGE they
 * do not hold. That is not the same claim: a Server Action is a POST endpoint
 * in its own right, reachable without the page that hosts it ever rendering.
 * Until this change, every moderation, course, scholarship and person-lookup
 * action called bare requireAdmin() — so an operator bounced from
 * /admin/reports could still submit the remove/restore form's action.
 *
 * This drives the FORM rather than the page: sign in as an operator who does
 * not hold the permission, navigate to a page they DO hold, and submit the
 * restricted action from there. If the guard is inherited rather than checked,
 * the write lands.
 *
 * THE ASSERTION IS ON THE DATABASE. An action can return an error for a dozen
 * reasons; the only thing that proves enforcement is the row not changing.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL_ && SERVICE);
if (process.env.CI && !configured) {
  throw new Error("admin-action-permissions spec cannot run in CI: missing Supabase credentials");
}
const db: SupabaseClient<Database> | null = configured
  ? createClient<Database>(URL_!, SERVICE!, { auth: { persistSession: false } })
  : null;

const tag = randomUUID().slice(0, 8);
let op = { id: "", email: "", password: "" };
let roleId = "", postingId = "", reporterId = "", blogPostId = "";

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

test.describe("Server Actions check their own permission", () => {
  test.skip(!configured, "needs Supabase credentials");

  test.beforeAll(async () => {
    // Starts holding reported_postings — revoked mid-test, below.
    const { data: r, error: re } = await db!
      .from("admin_roles").insert({ name: `action-perm ${tag}` }).select("id").single();
    if (re) throw new Error(`fixture role: ${re.message}`);
    roleId = r!.id;
    const { error: pe } = await db!
      .from("admin_role_permissions").insert([{ role_id: roleId, permission: "courses" },
                { role_id: roleId, permission: "reported_postings" },
                { role_id: roleId, permission: "blog" }]);
    if (pe) throw new Error(`fixture perms: ${pe.message}`);

    const email = `action-perm-${randomUUID()}@talentrah.test`;
    const password = `E2E-${randomUUID()}Aa1!`;
    const { data: u, error: ue } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
    if (ue) throw new Error(`fixture user: ${ue.message}`);
    op = { id: u!.user.id, email, password };
    const { error: ae } = await db!
      .from("admin_users").insert({ id: op.id, email, display_name: "action probe", role_id: roleId });
    if (ae) throw new Error(`fixture operator: ${ae.message}`);

    const { data: p, error: pe2 } = await db!.from("job_postings").insert({
      source_type: "external", company_name: "ACTION-PERM Co",
      title: `ACTION-PERM posting ${tag}`, description: "fixture",
      structured_jd: {}, status: "open", posted_at: new Date().toISOString(),
      dedup_fingerprint: `action-perm-${randomUUID()}`,
      external_source: "action-perm", external_url: `https://example.test/${randomUUID()}`,
    }).select("id").single();
    if (pe2) throw new Error(`fixture posting: ${pe2.message}`);
    postingId = p!.id;

    const { data: rep, error: rue } = await db!.auth.admin.createUser({
      email: `action-perm-reporter-${randomUUID()}@talentrah.test`,
      password: `E2E-${randomUUID()}Aa1!`, email_confirm: true,
    });
    if (rue) throw new Error(`fixture reporter: ${rue.message}`);
    reporterId = rep!.user.id;
    const { error: rre } = await db!.from("job_posting_reports").insert({
      job_posting_id: postingId, reporter_id: reporterId,
      reason: "scam", details: "ACTION-PERM fixture report.",
    });
    if (rre) throw new Error(`fixture report: ${rre.message}`);

    const { data: bp, error: bpe } = await db!.from("blog_posts").insert({
      slug: `action-perm-blog-${tag}`,
      title: "ACTION-PERM blog fixture",
      description: "Fixture post owned by e2e/admin-action-permissions.",
      author: "Tests",
      body: "## Fixture\n\nFixture body.",
      status: "draft",
    }).select("id").single();
    if (bpe) throw new Error(`fixture blog post: ${bpe.message}`);
    blogPostId = bp!.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    const { error: ae } = await db.from("admin_audit_log").delete().eq("admin_user_id", op.id);
    if (ae) console.error("[action-perm cleanup] audit:", ae.message);
    if (postingId) {
      const { error: re } = await db.from("job_posting_reports").delete().eq("job_posting_id", postingId);
      if (re) console.error("[action-perm cleanup] reports:", re.message);
      const { error } = await db.from("job_postings").delete().eq("id", postingId);
      if (error) console.error("[action-perm cleanup] posting:", error.message);
    }
    if (reporterId) {
      const { error } = await db.auth.admin.deleteUser(reporterId);
      if (error) console.error("[action-perm cleanup] reporter:", error.message);
    }
    if (blogPostId) {
      const { error } = await db.from("blog_posts").delete().eq("id", blogPostId);
      if (error) console.error("[action-perm cleanup] blog post:", error.message);
    }
    const { error: ue } = await db.from("admin_users").delete().eq("id", op.id);
    if (ue) console.error("[action-perm cleanup] admin_users:", ue.message);
    const { error: de } = await db.auth.admin.deleteUser(op.id);
    if (de) console.error("[action-perm cleanup] user:", de.message);
    // Role last — role_id is ON DELETE RESTRICT.
    const { error } = await db.from("admin_roles").delete().eq("id", roleId);
    if (error) console.error("[action-perm cleanup] role:", error.message);
  });

  test("revoking the permission stops the action, even with the form already rendered", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);

    /*
     * RENDER THE REAL FORM WHILE PERMITTED. Forging Next's Server Action wire
     * format by hand does not work — a hand-rolled POST is simply 404'd, so a
     * test built that way passes without ever invoking the action, which is
     * the worst kind of green. Driving the real form is the only way to be
     * sure the action actually runs.
     */
    await page.goto("/admin/reports");
    expect(new URL(page.url()).pathname, "fixture should start with reported_postings")
      .toBe("/admin/reports");
    const row = page.locator("li", { hasText: `ACTION-PERM posting ${tag}` }).first();
    await expect(row).toBeVisible();

    /*
     * NOW TAKE THE PERMISSION AWAY, with the form still on screen. Permissions
     * are read per request, so the next submit arrives from an operator who no
     * longer holds reported_postings — exactly the shape of "the page guard
     * already ran, so the action need not check".
     */
    const { error: revokeErr } = await db!
      .from("admin_role_permissions").delete()
      .eq("role_id", roleId).eq("permission", "reported_postings");
    expect(revokeErr, "failed to revoke the fixture permission").toBeNull();

    const before = await db!.from("job_postings").select("status").eq("id", postingId).single();
    expect(before.data?.status, "precondition").toBe("open");

    await row.getByRole("textbox").fill("unauthorised probe");
    await row.getByRole("button", { name: "Remove from the board" }).click();
    await page.waitForTimeout(3000);

    /*
     * THE ASSERTION IS THE ROW, not the response. An action can error for a
     * dozen reasons; only the posting still being `open` proves the guard.
     */
    const after = await db!.from("job_postings")
      .select("status, removal_reason, removed_by").eq("id", postingId).single();
    expect(after.data?.status, "LEAK: an operator without reported_postings removed a posting")
      .toBe("open");
    expect(after.data?.removal_reason, "LEAK: a removal reason was written").toBeNull();
    expect(after.data?.removed_by, "LEAK: a remover was recorded").toBeNull();
  });

  test("blog: revoking `blog` stops publishing, with the editor already open", async ({ page }) => {
    /*
     * The same claim as above, for the area that was not in #163's sweep. The
     * `blog` permission did not exist when that landed — 0077 added it after —
     * so the blog actions were left on bare requireAdmin(), which every
     * operator satisfies.
     *
     * Publishing is the action worth proving: it is the one that makes content
     * public, so an operator who should not hold it being able to POST the
     * form is the difference between "cannot reach the screen" and "cannot
     * publish".
     */
    await signIn(page);
    await page.goto(`/admin/blog/${blogPostId}`);
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

    // Take it away with the editor still on screen. Permissions are read per
    // request, so the next submit arrives from an operator who no longer holds it.
    const { error: revokeErr } = await db!
      .from("admin_role_permissions").delete()
      .eq("role_id", roleId).eq("permission", "blog");
    expect(revokeErr, "failed to revoke the fixture permission").toBeNull();

    const before = await db!.from("blog_posts")
      .select("status, published_at").eq("id", blogPostId).single();
    expect(before.data?.status, "precondition").toBe("draft");

    await page.getByRole("button", { name: "Publish" }).click();
    await page.waitForTimeout(3000);

    /*
     * THE ROW, not the response. A redirect or an error page proves nothing on
     * its own — only the post still being a draft proves the action checked.
     */
    const after = await db!.from("blog_posts")
      .select("status, published_at").eq("id", blogPostId).single();
    expect(after.data?.status, "LEAK: an operator without `blog` published a post").toBe("draft");
    expect(after.data?.published_at, "LEAK: published_at was stamped").toBeNull();
  });

  test("blog: the same operator cannot reach the blog screens either", async ({ page }) => {
    // The page guard, now that the permission is revoked. Both halves matter:
    // the action check is the control, and the page check is what stops the
    // screen rendering at all.
    await signIn(page);
    await page.goto("/admin/blog");
    expect(page.url(), "an operator without `blog` reached the blog list").not.toContain("/admin/blog");
  });
});
