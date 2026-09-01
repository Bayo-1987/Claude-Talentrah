import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";
import { acquireOperatorsLock } from "../tests/support/operators-lock";

/**
 * Per-area permission enforcement, driven by the URL.
 *
 * tests/rls/admin-permissions.test.ts proves the DATABASE refuses the wrong
 * operator/role mutations. This proves the thing only a browser can: that each
 * of the eight content areas refuses an operator whose role does not grant it
 * WHEN THEY TYPE THE ADDRESS, not merely that the link is missing.
 *
 * The distinction is the whole point, and it is already written down in
 * require-admin.ts: hiding a nav link is a courtesy to the operator, not a
 * control on them. A link you cannot see is still a URL you can type. If
 * requirePermission() were ever dropped from one of these pages, the nav would
 * look exactly the same and only this spec would notice.
 *
 * BOTH DIRECTIONS, per area. A guard that refuses everything passes a
 * refusal-only test, so each area is also visited by an operator who DOES hold
 * it and must load.
 */
type Perm = Database["public"]["Enums"]["admin_permission"];

const AREAS: { perm: Perm; path: string; marker: RegExp }[] = [
  { perm: "scholarships", path: "/admin/scholarships", marker: /scholarship/i },
  { perm: "reported_postings", path: "/admin/reports", marker: /flagged|reported/i },
  { perm: "ad_campaigns", path: "/admin/campaigns", marker: /campaign/i },
  { perm: "feedback", path: "/admin/feedback", marker: /feedback/i },
  { perm: "courses", path: "/admin/courses", marker: /course/i },
  { perm: "operations", path: "/admin/ops", marker: /operation|ingest|renewal/i },
  { perm: "finance", path: "/admin/finance", marker: /finance|credit|revenue/i },
  { perm: "people", path: "/admin/people", marker: /people|look ?up|search/i },
];

/** The subset the restricted operator holds. Everything else must be refused. */
const GRANTED: Perm[] = ["scholarships", "finance"];

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL_ && SERVICE);
if (process.env.CI && !configured) {
  throw new Error("admin-permissions spec cannot run in CI: missing Supabase URL or service-role key");
}
const db: SupabaseClient<Database> | null = configured
  ? createClient<Database>(URL_!, SERVICE!, { auth: { persistSession: false } })
  : null;

const tag = randomUUID().slice(0, 8);
interface Op { id: string; email: string; password: string; roleId: string }

async function makeRole(label: string, perms: Perm[]): Promise<string> {
  const { data, error } = await db!
    .from("admin_roles").insert({ name: `e2e-perm ${label} ${tag}` }).select("id").single();
  if (error) throw new Error(`fixture role: ${error.message}`);
  if (perms.length) {
    const { error: pe } = await db!
      .from("admin_role_permissions")
      .insert(perms.map((permission) => ({ role_id: data.id, permission })));
    if (pe) throw new Error(`fixture perms: ${pe.message}`);
  }
  return data.id;
}

async function makeOperator(label: string, roleId: string): Promise<Op> {
  const email = `e2e-perm-${label}-${randomUUID()}@talentrah.test`;
  const password = `E2E-${randomUUID()}Aa1!`;
  const { data, error } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`fixture user: ${error.message}`);
  const { error: rowError } = await db!
    .from("admin_users")
    .insert({ id: data.user.id, email, display_name: `e2e ${label}`, role_id: roleId });
  if (rowError) throw new Error(`fixture operator: ${rowError.message}`);
  return { id: data.user.id, email, password, roleId };
}

async function signIn(page: Page, op: Op) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for it to actually land, or every later assertion blames the wrong
  // thing — the same trap the moderation specs documented.
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

test.describe("per-area permissions", () => {
  test.skip(!configured, "needs the Supabase URL and service-role key");

  let restricted: Op, full: Op;
  let restrictedRole: string, fullRole: string;

  // `fullRole` holds `operators`, so this spec moves the global count too.
  let releaseOperatorsLock: (() => Promise<void>) | undefined;

  test.beforeAll(async () => {
    // This hook queues on the lease; the 30s config timeout is not enough.
    test.setTimeout(300_000);
    if (db) releaseOperatorsLock = await acquireOperatorsLock(db, "e2e-admin-permissions");
    restrictedRole = await makeRole("restricted", GRANTED);
    fullRole = await makeRole("full", [...AREAS.map((a) => a.perm), "operators", "blog"]);
    restricted = await makeOperator("restricted", restrictedRole);
    full = await makeOperator("full", fullRole);
  });

  /*
   * finally: the release must happen even if the teardown above throws, or a
   * lease outlives the run and every later run waits out its whole TTL.
   */
  test.afterAll(async () => {
    try {
      if (!db) return;
      const ids = [restricted?.id, full?.id].filter(Boolean) as string[];
      const { error: auditErr } = await db.from("admin_audit_log").delete().in("admin_user_id", ids);
      if (auditErr) console.error("[perm-e2e cleanup] audit:", auditErr.message);
      for (const id of ids) {
        const { error } = await db.auth.admin.deleteUser(id);
        if (error) console.error("[perm-e2e cleanup] user:", error.message);
      }
      // Roles last — admin_users.role_id is ON DELETE RESTRICT, so they can only
      // go once nothing references them. A refused delete RESOLVES with an error.
      const { error } = await db.from("admin_roles").delete().in("id", [restrictedRole, fullRole]);
      if (error) console.error("[perm-e2e cleanup] roles:", error.message);
    } finally {
      await releaseOperatorsLock?.();
    }
  });

  test("an operator is refused at the URL for every area their role does not grant", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, restricted);

    for (const area of AREAS) {
      const allowed = GRANTED.includes(area.perm);
      await page.goto(area.path);
      const landed = new URL(page.url()).pathname;

      if (allowed) {
        expect(landed, `${area.perm}: granted but was refused ${area.path}`).toBe(area.path);
      } else {
        // Bounced to the dashboard, and nothing of the page rendered.
        expect(landed, `LEAK: ${area.perm} not granted, yet ${area.path} loaded`).toBe("/admin");
        expect(
          landed,
          `LEAK: ${area.perm} not granted, yet ended up inside ${area.path}`,
        ).not.toContain(area.path.replace("/admin", "").replace("/", ""));
      }
    }
  });

  test("the nav shows only the granted areas — and the URL check above is what enforces it", async ({ page }) => {
    await signIn(page, restricted);
    await page.goto("/admin");
    // Scholarships and Finance are granted; the rest are not, and Operators
    // least of all.
    await expect(page.getByRole("link", { name: "Scholarships" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Finance" })).toBeVisible();
    // Blog and Operators are the count-less links; both must be hidden from a
    // role that grants neither.
    for (const label of ["Reported postings", "Ad campaigns", "Feedback", "Courses", "Operations", "Blog", "Operators"]) {
      await expect(page.getByRole("link", { name: label }), `${label} should be hidden`).toHaveCount(0);
    }
  });

  test("an operator holding everything reaches every area — the guard is not just refusing", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, full);
    for (const area of AREAS) {
      await page.goto(area.path);
      expect(new URL(page.url()).pathname, `${area.perm}: granted but refused`).toBe(area.path);
      await expect(page.locator("body")).toContainText(area.marker, { timeout: 15_000 });
    }
    await page.goto("/admin/operators");
    expect(new URL(page.url()).pathname).toBe("/admin/operators");

    // Blog is a count-less nav entry too, and a role holding it must see it.
    await expect(page.getByRole("link", { name: "Blog" })).toBeVisible();
  });
});
