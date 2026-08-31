/**
 * 0075's coverage invariant: at least one ACTIVE operator holds a role granting
 * `operators`.
 *
 * 0073's version was "at least one active super admin" and could be broken two
 * ways. This one can be broken five, and that is the whole reason the guard
 * changed shape:
 *
 *   1. disable that operator
 *   2. move them to a role without `operators`
 *   3. edit their role to drop `operators`
 *   4. delete their role
 *   5. any two of the above at the same instant
 *
 * (5) is why the mutex is the whole `admin_roles` table rather than 0073's set
 * of admin_users rows: a permissions edit and a reassignment touch different
 * rows, so a row-level lock would let both through and leave nobody able to
 * manage operators — with no way back in, because the page that fixes it is
 * the page the guard just locked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireOperatorsLock } from "../support/operators-lock";
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
 * without them: on one shared client Node keeps both calls on a single
 * connection and the second never reaches Postgres until the first returns.
 * Measured on 0073 — the unguarded implementation survives a shared-client
 * race untouched and loses immediately on separate clients.
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

type User = Awaited<ReturnType<typeof createAuthedTestUser>>;
let seeker: User, opA: User, opB: User, plain: User;
let managerRoleId: string, plainRoleId: string, spareRoleId: string;
const tag = randomUUID().slice(0, 8);

const roleName = (s: string) => `perm-test ${s} ${tag}`;

async function makeRole(label: string, perms: Database["public"]["Enums"]["admin_permission"][]) {
  const { data, error } = await admin
    .from("admin_roles").insert({ name: roleName(label) }).select("id").single();
  if (error) throw new Error(`fixture role: ${error.message}`);
  if (perms.length) {
    const { error: pe } = await admin
      .from("admin_role_permissions")
      .insert(perms.map((permission) => ({ role_id: data.id, permission })));
    if (pe) throw new Error(`fixture perms: ${pe.message}`);
  }
  return data.id;
}

async function makeOperator(u: User, role_id: string) {
  const { error } = await admin
    .from("admin_users")
    .insert({ id: u.id, email: u.email.toLowerCase(), display_name: `perm-test ${tag}`, role_id });
  if (error) throw new Error(`fixture operator: ${error.message}`);
}

const roleOf = async (id: string) =>
  (await admin.from("admin_users").select("role_id, disabled_at").eq("id", id).single()).data;

/** How many active operators can manage operators — counting ONLY this test's fixtures. */
async function coverage() {
  const { data: perms } = await admin
    .from("admin_role_permissions").select("role_id").eq("permission", "operators");
  const ids = (perms ?? []).map((p) => p.role_id);
  if (!ids.length) return 0;
  const { count } = await admin
    .from("admin_users").select("id", { count: "exact", head: true })
    .in("role_id", ids).is("disabled_at", null).in("id", [opA.id, opB.id, plain.id]);
  return count ?? 0;
}


/*
 * SERIALIZED against every other suite that creates an admin holding
 * `operators`. See tests/support/operators-lock.ts and 0082 — the short
 * version is that `admin_operators_covered()` is global, so "this is the last
 * holder" is only true while no other suite's holder exists.
 */
let releaseOperatorsLock: (() => Promise<void>) | undefined;

beforeAll(async () => {
  // FIRST, before any fixture exists: the lock is what makes the assertions
  // below about "the last holder" mean anything.
  releaseOperatorsLock = await acquireOperatorsLock(admin, "admin-permissions");
  [seeker, opA, opB, plain] = await Promise.all([
    createAuthedTestUser("perm-seeker"),
    createAuthedTestUser("perm-op-a"),
    createAuthedTestUser("perm-op-b"),
    createAuthedTestUser("perm-plain"),
  ]);
  managerRoleId = await makeRole("manager", ["operators", "finance"]);
  plainRoleId = await makeRole("plain", ["finance"]);
  spareRoleId = await makeRole("spare", ["courses"]);
  await makeOperator(opA, managerRoleId);
  await makeOperator(opB, managerRoleId);
  await makeOperator(plain, plainRoleId);
}, 300_000); // hook timeout: this hook QUEUES on the lease, and the
//                default 60s is shorter than a few suites' worth of waiting.

/*
   * The release is in a finally because it has to happen even when the
   * teardown above throws. It did throw once — a fixture was undefined after a
   * failed beforeAll — and the lease then stood for its whole TTL, so every
   * run that started in that window reported "skipped". A lock released only
   * on the happy path is a lock that converts one failure into a queue of
   * them.
   */
afterAll(async () => {
  try {
    const ids = [opA?.id, opB?.id, plain?.id].filter(Boolean) as string[];
    const { error: auditErr } = await admin.from("admin_audit_log").delete().in("admin_user_id", ids);
    if (auditErr) console.error("[perm cleanup] audit:", auditErr.message);
    await deleteTestUsers([seeker.id, ...ids]);
    // Roles last: admin_users.role_id is ON DELETE RESTRICT, so these can only
    // go once nothing references them. A refused delete RESOLVES with an error.
    const { error } = await admin
      .from("admin_roles").delete().in("id", [managerRoleId, plainRoleId, spareRoleId]);
    if (error) console.error("[perm cleanup] roles:", error.message);
    // LAST: releasing before teardown would hand a waiter the lock while this
    // suite's operators-holding admins are still in the table.
  } finally {
    await releaseOperatorsLock?.();
  }
});

describe("0075: the new tables are as unreachable as admin_users", () => {
  it("no client role can read roles or permissions — refused by ERROR, not an empty array", async () => {
    for (const [who, client] of [["anon", anon], ["seeker", seeker.client]] as const) {
      for (const table of ["admin_roles", "admin_role_permissions"] as const) {
        const { data, error } = await client.from(table).select("*");
        expect(error, `LEAK: ${who} read ${table} without error`).not.toBeNull();
        expect(data ?? [], `LEAK: ${who} got rows from ${table}`).toHaveLength(0);
      }
    }
  });

  it("no client role can grant itself a permission", async () => {
    const { error } = await seeker.client
      .from("admin_role_permissions")
      .insert({ role_id: plainRoleId, permission: "operators" });
    expect(error, "LEAK: a seeker granted a permission").not.toBeNull();
  });

  it("no client role may execute the mutation functions", async () => {
    for (const [who, client] of [["anon", anon], ["seeker", seeker.client]] as const) {
      const { error } = await client.rpc("admin_set_operator", {
        p_actor: opA.id, p_target: plain.id, p_role_id: managerRoleId,
      });
      expect(error, `LEAK: ${who} executed admin_set_operator`).not.toBeNull();
    }
  });
});

describe("0075: only a holder of `operators` may act", () => {
  it("an operator without the permission is refused as the actor", async () => {
    const { data } = await admin.rpc("admin_set_operator", {
      p_actor: plain.id, p_target: opA.id, p_role_id: plainRoleId,
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    expect((await roleOf(opA.id))?.role_id).toBe(managerRoleId);
  });

  it("a disabled holder is refused as the actor", async () => {
    await admin.from("admin_users").update({ disabled_at: new Date().toISOString() }).eq("id", opB.id);
    const { data } = await admin.rpc("admin_set_operator", {
      p_actor: opB.id, p_target: plain.id, p_role_id: managerRoleId,
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    await admin.from("admin_users").update({ disabled_at: null }).eq("id", opB.id);
  });
});

describe("0075: coverage survives every one of the five mutations", () => {
  it("(1) the last holder cannot be disabled", async () => {
    // Leave exactly one: move opB off the manager role.
    const off = await admin.rpc("admin_set_operator", {
      p_actor: opA.id, p_target: opB.id, p_role_id: plainRoleId,
    });
    expect(off.data?.[0]?.ok, off.data?.[0]?.reason).toBe(true);

    const res = await admin.rpc("admin_set_operator", {
      p_actor: opA.id, p_target: opA.id, p_disabled: true,
    });
    expect(res.data?.[0]?.ok).toBe(false);
    expect(res.data?.[0]?.reason).toBe("last_operator_admin");
    expect((await roleOf(opA.id))?.disabled_at).toBeNull();
  });

  it("(2) the last holder cannot be moved to a role without the permission", async () => {
    const res = await admin.rpc("admin_set_operator", {
      p_actor: opA.id, p_target: opA.id, p_role_id: plainRoleId,
    });
    expect(res.data?.[0]?.ok).toBe(false);
    expect(res.data?.[0]?.reason).toBe("last_operator_admin");
    expect((await roleOf(opA.id))?.role_id).toBe(managerRoleId);
  });

  it("(3) the last covering role cannot have `operators` edited out of it", async () => {
    const res = await admin.rpc("admin_upsert_role", {
      p_actor: opA.id, p_role_id: managerRoleId, p_name: roleName("manager"),
      p_permissions: ["finance"],
    });
    expect(res.data?.[0]?.ok).toBe(false);
    expect(res.data?.[0]?.reason).toBe("last_operator_admin");
    // and the permission is still there — the savepoint rolled the edit back
    const { data: still } = await admin
      .from("admin_role_permissions").select("permission")
      .eq("role_id", managerRoleId).eq("permission", "operators");
    expect(still, "the rollback did not restore the permission").toHaveLength(1);
  });

  it("(4) a role still assigned to somebody cannot be deleted", async () => {
    const res = await admin.rpc("admin_delete_role", { p_actor: opA.id, p_role_id: managerRoleId });
    expect(res.data?.[0]?.ok).toBe(false);
    expect(res.data?.[0]?.reason).toBe("role_in_use");
  });

  it("a builtin role cannot be deleted at all", async () => {
    const { data: builtin } = await admin
      .from("admin_roles").select("id").eq("name", "Super Admin").single();
    const res = await admin.rpc("admin_delete_role", { p_actor: opA.id, p_role_id: builtin!.id });
    expect(res.data?.[0]?.ok).toBe(false);
    expect(res.data?.[0]?.reason).toBe("builtin");
  });

  it("an unassigned custom role CAN be deleted — the guard is not just refusing everything", async () => {
    const doomed = await makeRole(`doomed-${randomUUID().slice(0, 6)}`, ["courses"]);
    const res = await admin.rpc("admin_delete_role", { p_actor: opA.id, p_role_id: doomed });
    expect(res.data?.[0]?.ok, res.data?.[0]?.reason).toBe(true);
    const { data: gone } = await admin.from("admin_roles").select("id").eq("id", doomed);
    expect(gone).toHaveLength(0);
  });

  /*
   * THE 0073 BRIDGE, tested here rather than in its own file.
   *
   * admin_update_operator is what the previously-deployed build calls. It now
   * delegates to admin_set_operator, so it must reach the same refusal — and
   * it must keep the deprecated `admin_users.role` text column truthful while
   * that column still exists, deriving it from whether the new role grants
   * `operators`.
   *
   * It lives in this file because it touches coverage, and coverage is global:
   * asserting "the last holder" from two files that both create covering
   * operators makes each pass alone and fail together. One file owns it.
   */
  it("the deprecated bridge reaches the same guard, and keeps `role` truthful", async () => {
    const { data: promoted } = await admin.rpc("admin_update_operator", {
      p_actor: opA.id, p_target: plain.id, p_role: "super_admin",
    });
    expect(promoted?.[0]?.ok, promoted?.[0]?.reason).toBe(true);
    expect(promoted?.[0]?.new_role, "the bridge must keep the text column in step").toBe("super_admin");

    const { data: row } = await admin
      .from("admin_users").select("role, role_id").eq("id", plain.id).single();
    expect(row?.role).toBe("super_admin");
    expect(row?.role_id, "the bridge must set role_id, not just the text").not.toBeNull();

    // Put them back, and check the derivation the other way.
    const { data: demoted } = await admin.rpc("admin_update_operator", {
      p_actor: opA.id, p_target: plain.id, p_role: "standard",
    });
    expect(demoted?.[0]?.ok, demoted?.[0]?.reason).toBe(true);
    expect(demoted?.[0]?.new_role).toBe("standard");

    await admin.rpc("admin_set_operator", {
      p_actor: opA.id, p_target: plain.id, p_role_id: plainRoleId,
    });
  });

  /*
   * (5) THE ONE THAT TESTS THE MUTEX, and the reason it had to widen.
   *
   * Two mutations that shrink coverage in DIFFERENT ways, fired together:
   * one moves the second-to-last holder off the covering role, the other edits
   * that role to drop `operators`. They touch different tables, so 0073's
   * row-level lock over admin_users would not have serialised them and both
   * would commit — leaving nobody able to manage operators.
   */
  it("(5) CONCURRENTLY: a reassignment and a permissions edit cannot both land", async () => {
    // Put opB back so there are two holders again.
    const back = await admin.rpc("admin_set_operator", {
      p_actor: opA.id, p_target: opB.id, p_role_id: managerRoleId,
    });
    expect(back.data?.[0]?.ok, back.data?.[0]?.reason).toBe(true);
    expect(await coverage()).toBe(2);

    const [reassign, edit] = await Promise.all([
      raceA.rpc("admin_set_operator", {
        p_actor: opA.id, p_target: opB.id, p_role_id: plainRoleId,
      }),
      raceB.rpc("admin_upsert_role", {
        p_actor: opB.id, p_role_id: managerRoleId, p_name: roleName("manager"),
        p_permissions: ["finance"],
      }),
    ]);

    const results = [reassign.data?.[0], edit.data?.[0]];
    const wins = results.filter((r) => r?.ok).length;

    // At most one may land. Both landing is the lockout this guard exists for.
    expect(wins, "both mutations committed — the mutex does not span both tables").toBeLessThanOrEqual(1);
    expect(await coverage(), "LOCKOUT: nobody can manage operators any more").toBeGreaterThanOrEqual(1);
  });
});
