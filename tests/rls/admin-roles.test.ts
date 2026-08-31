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

async function makeOperator(
  user: Awaited<ReturnType<typeof createAuthedTestUser>>,
  role: "super_admin" | "standard",
) {
  const { error } = await admin.from("admin_users").insert({
    id: user.id,
    email: user.email.toLowerCase(),
    display_name: `roles-test ${role}`,
    role,
  });
  if (error) throw new Error(`fixture operator: ${error.message}`);
}

const roleOf = async (id: string) =>
  (await admin.from("admin_users").select("role, disabled_at").eq("id", id).single()).data;

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

describe("0073: at least one active super admin always survives", () => {
  it("promoting and demoting works while another super admin remains", async () => {
    const up = await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: standard.id, p_role: "super_admin",
    });
    expect(up.data?.[0]?.ok, up.data?.[0]?.reason).toBe(true);
    expect((await roleOf(standard.id))?.role).toBe("super_admin");

    const down = await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: standard.id, p_role: "standard",
    });
    expect(down.data?.[0]?.ok, down.data?.[0]?.reason).toBe(true);
    expect((await roleOf(standard.id))?.role).toBe("standard");
  });

  it("disabling revokes live sessions in the same breath", async () => {
    const { data: sess } = await admin
      .from("admin_sessions")
      .insert({
        admin_user_id: standard.id,
        token_hash: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      })
      .select("id")
      .single();

    const res = await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: standard.id, p_disabled: true,
    });
    expect(res.data?.[0]?.ok, res.data?.[0]?.reason).toBe(true);

    const { data: after } = await admin
      .from("admin_sessions").select("revoked_at").eq("id", sess!.id).single();
    expect(after?.revoked_at, "a disabled operator kept a live session").not.toBeNull();

    await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: standard.id, p_disabled: false,
    });
  });

  it("SEQUENTIALLY: the last active super admin cannot be demoted or disabled", async () => {
    // Leave exactly one: demote B, so only A is a super admin.
    const demoteB = await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: superB.id, p_role: "standard",
    });
    expect(demoteB.data?.[0]?.ok, demoteB.data?.[0]?.reason).toBe(true);
    expect(await activeSupers()).toBeGreaterThanOrEqual(1);

    const selfDemote = await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: superA.id, p_role: "standard",
    });
    expect(selfDemote.data?.[0]?.ok).toBe(false);
    expect(selfDemote.data?.[0]?.reason).toBe("last_super_admin");

    const selfDisable = await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: superA.id, p_disabled: true,
    });
    expect(selfDisable.data?.[0]?.ok).toBe(false);
    expect(selfDisable.data?.[0]?.reason).toBe("last_super_admin");

    expect((await roleOf(superA.id))?.role).toBe("super_admin");
    expect((await roleOf(superA.id))?.disabled_at).toBeNull();

    // Put B back for the concurrency test below.
    await admin.rpc("admin_update_operator", {
      p_actor: superA.id, p_target: superB.id, p_role: "super_admin",
    });
  });

  /*
   * THE ONE THAT ACTUALLY TESTS THE LOCK.
   *
   * Two super admins demoting each other at the same instant. Each, reading
   * alone, sees one other super admin and concludes the demotion is safe. A
   * read-then-write implementation lets BOTH commit and leaves zero — and the
   * sequential test above passes against that broken version, which is exactly
   * why it is not sufficient on its own.
   */
  it("CONCURRENTLY: two mutual demotions cannot both succeed", async () => {
    expect(await activeSupers(), "precondition: exactly two active super admins")
      .toBeGreaterThanOrEqual(2);

    // Separate clients — see the note beside their construction. On one shared
    // client these two do not overlap and the test proves nothing.
    const [a, b] = await Promise.all([
      raceA.rpc("admin_update_operator", {
        p_actor: superA.id, p_target: superB.id, p_role: "standard",
      }),
      raceB.rpc("admin_update_operator", {
        p_actor: superB.id, p_target: superA.id, p_role: "standard",
      }),
    ]);

    const results = [a.data?.[0], b.data?.[0]];
    const wins = results.filter((r) => r?.ok).length;
    const losers = results.filter((r) => !r?.ok);

    expect(wins, "both demotions committed — the guard is not atomic").toBe(1);
    expect(losers, "one of the two must be refused").toHaveLength(1);

    /*
     * WHICH refusal is ordering-dependent, and asserting one specific reason
     * over-fits — the first version of this test did, and failed for that
     * rather than for a real defect. Whoever loses the lock has, by then,
     * already been demoted by the winner, so its own actor check now fails and
     * it is turned away as `not_authorised` before the invariant is ever
     * consulted. Had the winner instead been demoting a third party, the loser
     * would reach the count and be told `last_super_admin`. Both are correct
     * refusals; the invariant below is the thing that actually matters.
     */
    expect(
      ["last_super_admin", "not_authorised"],
      `unexpected refusal reason: ${losers[0]?.reason}`,
    ).toContain(losers[0]?.reason);

    expect(await activeSupers(), "LOCKOUT: zero active super admins remain")
      .toBeGreaterThanOrEqual(1);
  });
});
