/**
 * 0073's two-tier operator roles: the invariant, and the isolation.
 *
 * Two claims are worth a standing test, and they fail in different ways.
 *
 * THE INVARIANT — there must always be at least one active Super Admin. If
 * that ever breaks, nobody can reach /admin/operators to fix it, because the
 * page that fixes it is the page the guard just locked; recovery is a
 * service-role intervention. The check and the write happen in ONE statement
 * under a lock (admin_update_operator), for the same reason spendCredits had
 * to become spend_credits_atomic: a read-then-act count is not a guard. So the
 * concurrent case is tested, not just the sequential one — the sequential
 * version passes even against the broken implementation.
 *
 * THE ISOLATION — 0073 adds a column carrying privilege to a table no client
 * may touch. CLAUDE.md's rule is that a row policy does not restrict columns,
 * so a value-bearing column normally needs a column grant. Here it needs
 * nothing, because 0060 revoked every privilege on the table outright. That is
 * a claim about the current grants, so it is asserted rather than believed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/*
 * TWO SEPARATE SERVICE-ROLE CLIENTS, and the concurrency test is worthless
 * without them.
 *
 * Sharing one client makes `Promise.all` look concurrent and not be: Node's
 * fetch keeps the calls on one connection and the second request does not
 * reach Postgres until the first has returned. Measured, not assumed — the
 * deliberately-unsafe read-then-write implementation this guard replaces
 * survives a shared-client race untouched (1 win, 1 super admin left) and
 * loses immediately on separate clients (2 wins, ZERO super admins left).
 *
 * So a shared-client version of the test below would pass against the broken
 * implementation it exists to reject.
 */
const raceA: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const raceB: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let seeker: Awaited<ReturnType<typeof createAuthedTestUser>>;
let superA: Awaited<ReturnType<typeof createAuthedTestUser>>;
let superB: Awaited<ReturnType<typeof createAuthedTestUser>>;
let standard: Awaited<ReturnType<typeof createAuthedTestUser>>;

/*
 * ROLE_ID AS WELL AS `role`, since 0075.
 *
 * This suite exercises admin_update_operator, which 0075 kept as the bridge
 * for the previously-deployed build: it takes a text role and now delegates to
 * admin_set_operator. Permissions are decided by `role_id`, so a fixture that
 * sets only the text column holds nothing and every mutation here is refused
 * `not_authorised` — which is what happened the first time 0075 ran against
 * this file. Setting both is also what makes this a real test OF the bridge
 * rather than of the old column.
 */
async function makeOperator(
  user: Awaited<ReturnType<typeof createAuthedTestUser>>,
  role: "super_admin" | "standard",
) {
  const { data: roleRow, error: roleErr } = await admin
    .from("admin_roles")
    .select("id")
    .eq("name", role === "super_admin" ? "Super Admin" : "Standard Admin")
    .single();
  if (roleErr) throw new Error(`fixture role lookup: ${roleErr.message}`);

  const { error } = await admin.from("admin_users").insert({
    id: user.id,
    email: user.email.toLowerCase(),
    display_name: `roles-test ${role}`,
    role,
    role_id: roleRow.id,
  });
  if (error) throw new Error(`fixture operator: ${error.message}`);
}

const roleOf = async (id: string) =>
  (await admin.from("admin_users").select("role, disabled_at").eq("id", id).single()).data;

/*
 * Reading the DEPRECATED text column on purpose: this suite's job is that the
 * bridge keeps it truthful for as long as it exists. admin_set_operator
 * derives it from whether the new role grants `operators`, so these assertions
 * are checking that derivation, not the old model.
 */

const activeSupers = async () =>
  (await admin
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .is("disabled_at", null)).count ?? 0;


beforeAll(async () => {
  [seeker, superA, superB, standard] = await Promise.all([
    createAuthedTestUser("roles-seeker"),
    createAuthedTestUser("roles-super-a"),
    createAuthedTestUser("roles-super-b"),
    createAuthedTestUser("roles-standard"),
  ]);
  await makeOperator(superA, "super_admin");
  await makeOperator(superB, "super_admin");
  await makeOperator(standard, "standard");
});

afterAll(async () => {
  // Audit rows are ON DELETE SET NULL, so clear them by id BEFORE the cascade
  // removes the id they are found by. A refused delete RESOLVES with an error.
  const { error } = await admin
    .from("admin_audit_log")
    .delete()
    .in("admin_user_id", [superA.id, superB.id, standard.id]);
  if (error) console.error("[admin-roles cleanup] audit:", error.message);
  await deleteTestUsers([seeker.id, superA.id, superB.id, standard.id]);
});

describe("0073: the role column is as unreachable as the table it sits on", () => {
  it("no client role can read `role` — the denial is an ERROR, not an empty array", async () => {
    for (const [label, client] of [
      ["anon", anon],
      ["authenticated seeker", seeker.client],
    ] as const) {
      const { data, error } = await client.from("admin_users").select("id, role");
      // Both halves matter. A revoked privilege errors; a policy that matches
      // nothing returns [] with no error, and only one of those is safe.
      expect(error, `LEAK: ${label} read admin_users.role without error`).not.toBeNull();
      expect(data ?? [], `LEAK: ${label} got rows back`).toHaveLength(0);
    }
  });

  it("no client role can WRITE `role` — the privilege-escalation path", async () => {
    const { error } = await seeker.client
      .from("admin_users")
      .update({ role: "super_admin" })
      .eq("id", superA.id);
    expect(error, "LEAK: a seeker rewrote an operator's role").not.toBeNull();
    expect((await roleOf(superA.id))?.role).toBe("super_admin");
  });

  it("no client role may EXECUTE admin_update_operator", async () => {
    for (const [label, client] of [
      ["anon", anon],
      ["authenticated seeker", seeker.client],
    ] as const) {
      const { error } = await client.rpc("admin_update_operator", {
        p_actor: superA.id,
        p_target: standard.id,
        p_role: "super_admin",
      });
      expect(error, `LEAK: ${label} executed admin_update_operator`).not.toBeNull();
    }
  });
});

describe("0073: only an active super admin may act", () => {
  it("a standard admin is refused as the actor", async () => {
    const { data } = await admin.rpc("admin_update_operator", {
      p_actor: standard.id,
      p_target: superA.id,
      p_role: "standard",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    expect((await roleOf(superA.id))?.role).toBe("super_admin");
  });

  it("a disabled super admin is refused as the actor", async () => {
    await admin.from("admin_users").update({ disabled_at: new Date().toISOString() }).eq("id", superB.id);
    const { data } = await admin.rpc("admin_update_operator", {
      p_actor: superB.id,
      p_target: standard.id,
      p_role: "super_admin",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    await admin.from("admin_users").update({ disabled_at: null }).eq("id", superB.id);
  });

  it("an unknown target is reported, not silently ignored", async () => {
    const { data } = await admin.rpc("admin_update_operator", {
      p_actor: superA.id,
      p_target: randomUUID(),
      p_role: "standard",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_found");
  });
});

/*
 * THE COVERAGE INVARIANT IS NOT TESTED HERE ANY MORE — it moved wholesale to
 * tests/rls/admin-permissions.test.ts, and the reason is worth recording.
 *
 * admin_operators_covered() is GLOBAL: it asks whether ANY active operator
 * anywhere holds `operators`. So a test that needs to be "the last one" cannot
 * share a run with another file that also creates covering operators — and
 * vitest runs files in parallel. With the invariant asserted in both files,
 * this suite's fixtures silently satisfied that one's coverage and seven of
 * its assertions stopped being true. Each file passed alone; together they
 * did not.
 *
 * That is the same shared-mutable-state shape as issue #136, so the fix is the
 * one that issue argues for: exactly one file owns the state. This file keeps
 * what is genuinely local to it — grant isolation, and the actor checks on the
 * deprecated bridge.
 */
