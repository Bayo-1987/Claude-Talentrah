/**
 * Admin > Courses (a catalog row's edit form + Make live / Take out): the form rule (QA, 9 Oct). Save changes twice in a row ("Saved." each time, the database agrees, nothing lost), make a
 * course live and take it out again, then once with a deliberate error (a link that does not start with http:// or https://): the error is shown, the database is untouched, and every field
 * still holds what was typed. Local stack only; a throwaway operator holding only "courses" signs in through the real /admin/login page; throwaway catalog rows.
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
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-courses-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-course-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
let courseId = "";

test.describe("admin: courses form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");

  test.beforeAll(async () => {
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-course-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "courses" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Course Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    const { data: c, error: cErr } = await db!.from("course_recommendations").insert({ title: `QA Course ${tag}`, provider: "QA Provider", skill_tag: `qa-skill-${tag}`, price_tier: "free", affiliate_url: "https://example.test/qa-course", active: false }).select("id").single();
    if (cErr || !c) throw new Error(`fixture course: ${cErr?.message}`);
    courseId = c.id;
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["course", async () => { const { error } = await db!.from("course_recommendations").delete().eq("id", courseId); if (error) throw new Error(error.message); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["role", async () => { await db!.from("admin_roles").delete().eq("id", op.roleId); }],
    );
  });

  test("save twice, make live and take out, then a refused link keeps every typed field", async ({ page }, info) => {
    test.setTimeout(150_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/courses");

    const f = (name: string) => page.locator(`#${name}-${courseId}`);
    const row = () => f("title").locator("xpath=ancestor::li[1]");
    const dbRow = async () => (await db!.from("course_recommendations").select("title, provider, skill_tag, price_tier, affiliate_url, active").eq("id", courseId).single()).data;
    const edit = async (v: { title: string; provider: string; skill: string; tier: string; url: string }) => {
      await f("title").fill(v.title);
      await f("provider").fill(v.provider);
      await f("skill").fill(v.skill);
      await f("tier").selectOption(v.tier);
      await f("url").fill(v.url);
      await submitAndSettle(page, () => row().getByRole("button", { name: "Save changes" }).click());
    };
    const typed = async () => ({ title: await f("title").inputValue(), provider: await f("provider").inputValue(), skill: await f("skill").inputValue(), tier: await f("tier").inputValue(), url: await f("url").inputValue() });

    const one = { title: `QA Course one ${tag}`, provider: "QA Provider One", skill: `qa-one-${tag}`, tier: "low", url: "https://example.test/one" };
    const two = { title: `QA Course two ${tag}`, provider: "QA Provider Two", skill: `qa-two-${tag}`, tier: "mid", url: "https://example.test/two" };
    await edit(one);
    await expect(row().getByRole("status")).toContainText("Saved", { timeout: 30_000 });
    await shot("1-first-save");
    expect(await dbRow()).toMatchObject({ title: one.title, provider: one.provider, skill_tag: one.skill, price_tier: one.tier, affiliate_url: one.url });
    await edit(two);
    await expect.poll(async () => (await dbRow())?.title, { timeout: 30_000 }).toBe(two.title);
    expect(await dbRow()).toMatchObject({ provider: two.provider, skill_tag: two.skill, price_tier: two.tier, affiliate_url: two.url });
    await settle(page); // the page has re-rendered with the saved row
    expect.soft(await typed(), "COURSE-TIER-1: after a successful save the fields show what was saved").toEqual(two);

    // COURSE-TIER-1 probe: change ONLY the title and save; the tier the operator saved must not change.
    await f("title").fill(`QA Course title only ${tag}`);
    await submitAndSettle(page, () => row().getByRole("button", { name: "Save changes" }).click());
    await expect.poll(async () => (await dbRow())?.title, { timeout: 30_000 }).toBe(`QA Course title only ${tag}`);
    expect.soft((await dbRow())?.price_tier, "COURSE-TIER-1: a title-only save must not change the price tier").toBe(two.tier);
    await settle(page);
    two.title = `QA Course title only ${tag}`;
    await submitAndSettle(page, () => row().getByRole("button", { name: "Make live" }).click());
    await expect.poll(async () => (await dbRow())?.active, { timeout: 30_000 }).toBe(true);
    await expect(row().getByRole("status")).toBeVisible();
    await submitAndSettle(page, () => row().getByRole("button", { name: "Take out of recommendations" }).click());
    await expect.poll(async () => (await dbRow())?.active, { timeout: 30_000 }).toBe(false);
    await settle(page);

    // Deliberate error: a link that is not http(s).
    const bad = { title: `QA Course bad ${tag}`, provider: "QA Provider Bad", skill: `qa-bad-${tag}`, tier: "high", url: "ftp://example.test/bad" };
    await edit(bad);
    await expect.poll(async () => (await page.getByRole("status").allInnerTexts()).join("|"), { timeout: 30_000 }).toMatch(/./); // some message is shown
    // COURSE-MSG-1: once a Make live / Take out has run on this row, its message is shown ahead of any later Save result, so the refusal below never appears.
    expect.soft(await row().getByRole("status").innerText(), "the refusal must be what the page says").toContain("http");
    await shot("3-bad-link");
    await settle(page);
    expect((await dbRow())?.title, "database untouched").toBe(two.title);
    expect(await typed(), "the error must keep what was typed").toEqual(bad);
  });
});
