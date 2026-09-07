/**
 * The actor used when a change happened outside the app.
 *
 * WHAT THIS IS PROTECTING. The audit trail's whole value is that a name in it
 * means that person. `recordSystemAction` exists because some changes genuinely
 * have no admin session — a migration applied by a coding session on the
 * founder's instruction — and the alternative was stamping a founder's identity
 * on something they did not do, which is worse than a gap because it cannot be
 * told apart from real attribution.
 *
 * That makes this function a liability as well as a fix: used inside `/admin/*`
 * to dodge threading an identity, it would turn every attributed row into a
 * maybe. Hence the last test here, which asserts it has no callers in the app
 * at all.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Database } from "@/lib/supabase/types";
import { recordSystemAction, SYSTEM_TOOLING_ACTOR } from "@/lib/admin/audit";

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ROOT = join(__dirname, "..", "..");
const written: string[] = [];

afterAll(async () => {
  if (!written.length) return;
  const { error } = await admin.from("admin_audit_log").delete().in("action", written);
  if (error) console.error("[system-audit cleanup]", error.message);
});

describe("the sentinel actor", () => {
  it("is on a TLD that cannot be registered, so it can never be a real mailbox", () => {
    // `.internal` is reserved by ICANN for private use. That is what makes the
    // collision impossible by construction rather than merely unlikely.
    expect(SYSTEM_TOOLING_ACTOR).toMatch(/^[a-z-]+@[a-z-]+\.internal$/);
    expect(SYSTEM_TOOLING_ACTOR).toBe("system-tooling@talentrah.internal");
  });

  it("belongs to no operator", async () => {
    // Asserted against the database, not assumed from the shape of the string.
    const { data, error } = await admin
      .from("admin_users")
      .select("id")
      .eq("email", SYSTEM_TOOLING_ACTOR);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("recordSystemAction", () => {
  it("writes a row with no account, no session, and the sentinel email", async () => {
    const action = `test.system_action_${randomUUID().slice(0, 8)}`;
    written.push(action);

    await recordSystemAction({
      action,
      targetTable: "admin_roles",
      targetId: "00000000-0000-4000-8000-000000000000",
      detail: { backfilled: true, note: "shape check" },
    });

    const { data, error } = await admin
      .from("admin_audit_log")
      .select("admin_user_id, admin_email, admin_session_id, action, target_table, target_id, detail")
      .eq("action", action);

    expect(error).toBeNull();
    expect(data, "exactly one row per call").toHaveLength(1);

    const row = data![0];
    // The three columns that say "no person did this".
    expect(row.admin_user_id).toBeNull();
    expect(row.admin_session_id).toBeNull();
    expect(row.admin_email).toBe(SYSTEM_TOOLING_ACTOR);
    // …and it still records what happened.
    expect(row.target_table).toBe("admin_roles");
    expect(row.detail).toMatchObject({ backfilled: true, note: "shape check" });
  });

  it("never throws, even when the write cannot succeed", async () => {
    // A failed audit write must not roll back the thing it was describing. The
    // action column is bounded, so an absurd value exercises the failure path
    // rather than the happy one.
    await expect(
      recordSystemAction({ action: "x".repeat(5000), detail: null }),
    ).resolves.toBeUndefined();
  });
});

describe("it stays out of the app", () => {
  it("has no caller anywhere under src/", () => {
    /*
     * THIS IS THE REAL GUARD. Every in-app action must keep using
     * recordAdminAction with the acting admin's own identity; one call site
     * reaching for the sentinel to avoid threading an identity would make every
     * other attributed row unverifiable.
     */
    const hits = execSync(
      "grep -rln 'recordSystemAction' src/ || true",
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      // Its own definition is not a caller.
      .filter((f) => f !== "src/lib/admin/audit.ts");

    expect(hits, `recordSystemAction is called from app code: ${hits.join(", ")}`).toEqual([]);
  });

  it("left every existing recordAdminAction call site alone", () => {
    // Additive, not a replacement: the existing callers must still pass a real
    // identity. If one of them lost its `identity:` argument, this catches it.
    const callers = execSync(
      "grep -rln 'recordAdminAction(' src/ || true",
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => f !== "src/lib/admin/audit.ts");

    expect(callers.length, "expected the existing audit call sites to still exist").toBeGreaterThan(0);

    for (const file of callers) {
      const src = readFileSync(join(ROOT, file), "utf8");
      const calls = src.split("recordAdminAction(").slice(1);
      for (const call of calls) {
        const head = call.slice(0, 400);
        expect(head, `${file}: a recordAdminAction call lost its identity`).toContain("identity");
      }
    }
  });
});
