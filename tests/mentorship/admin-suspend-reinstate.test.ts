/**
 * admin_suspend_mentor / admin_reinstate_mentor (0173) — the gap-3 pair that
 * lets an admin actually reach `status = 'suspended'`, which 0133's check
 * constraint has allowed since day one but no code path could ever set.
 *
 * SAME SHAPE AS admin_moderate_mentor_application (0133): permission check +
 * conditional UPDATE ... WHERE status = '<expected>' in one statement, so
 * this suite proves the same two things that shape exists to guarantee —
 * only the RIGHT starting status can transition, and two concurrent callers
 * can't both "win" — using the same two-separate-service-role-clients
 * concurrency pattern tests/rls/admin-permissions.test.ts and
 * tests/rls/admin-roles.test.ts already establish (a shared client makes
 * Promise.all look concurrent without actually being concurrent — Node keeps
 * both calls on one connection).
 *
 * ALSO covers the self-pause/admin-suspend interaction (0174's own stated
 * trap): suspending a mentor and then having them flip self_paused back to
 * false must have zero effect on public visibility, because visibility is
 * `status = 'approved' AND NOT self_paused` — an AND, not an OR. This is the
 * one place a plausible-looking implementation could still leave the exact
 * hole the design is meant to close, so it is proven directly here rather
 * than only inferred from the two conditions being separately correct.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`admin-suspend-reinstate suite cannot run: ${key} is not set.`);
}

/*
 * TWO SEPARATE SERVICE-ROLE CLIENTS for the concurrency test — see
 * admin-permissions.test.ts's own comment on why a shared client would make
 * the race test pass against a broken, unguarded implementation too.
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

const tag = randomUUID().slice(0, 8);

type User = Awaited<ReturnType<typeof createAuthedTestUser>>;
let adminActor: User;
let noPermActor: User;
let mentee: User;
let roleId: string;
let noPermRoleId: string;

const mentorIds: string[] = [];

async function makeMentor(status: "approved" | "suspended" | "pending" | "rejected", suffix: string) {
  const u = await createAuthedTestUser(`suspend-${suffix}`);
  const { error } = await admin.from("mentor_profiles").insert({
    user_id: u.id,
    status,
    bio: `fixture mentor ${tag}`,
    base_price_ngn: 10_000,
  });
  if (error) throw new Error(`fixture mentor: ${error.message}`);
  mentorIds.push(u.id);
  return u;
}

beforeAll(async () => {
  [adminActor, noPermActor, mentee] = await Promise.all([
    createAuthedTestUser("suspend-admin"),
    createAuthedTestUser("suspend-no-perm"),
    createAuthedTestUser("suspend-mentee"),
  ]);

  const { data: role, error: roleError } = await admin
    .from("admin_roles")
    .insert({ name: `mentor-review ${tag}` })
    .select("id")
    .single();
  if (roleError || !role) throw new Error(`fixture role: ${roleError?.message}`);
  roleId = role.id;
  const { error: permError } = await admin
    .from("admin_role_permissions")
    .insert({ role_id: roleId, permission: "mentor_review" });
  if (permError) throw new Error(`fixture perm: ${permError.message}`);

  const { data: noPermRole, error: noPermRoleError } = await admin
    .from("admin_roles")
    .insert({ name: `no-mentor-review ${tag}` })
    .select("id")
    .single();
  if (noPermRoleError || !noPermRole) throw new Error(`fixture role: ${noPermRoleError?.message}`);
  noPermRoleId = noPermRole.id;
  // No admin_role_permissions row at all — this role grants nothing.

  const { error: opError } = await admin.from("admin_users").insert([
    { id: adminActor.id, email: adminActor.email.toLowerCase(), display_name: `suspend-admin ${tag}`, role_id: roleId },
    { id: noPermActor.id, email: noPermActor.email.toLowerCase(), display_name: `no-perm ${tag}`, role_id: noPermRoleId },
  ]);
  if (opError) throw new Error(`fixture admin_users: ${opError.message}`);
}, 60_000);

afterAll(async () => {
  await admin.from("admin_audit_log").delete().in("admin_user_id", [adminActor.id, noPermActor.id]);
  await admin.from("admin_users").delete().in("id", [adminActor.id, noPermActor.id]);
  await admin.from("admin_roles").delete().in("id", [roleId, noPermRoleId]);
  await admin.from("mentor_profiles").delete().in("user_id", mentorIds);
  await deleteTestUsers([adminActor.id, noPermActor.id, mentee.id, ...mentorIds]);
}, 60_000);

describe("admin_suspend_mentor", () => {
  it("suspends an APPROVED mentor, requiring a note", async () => {
    const m = await makeMentor("approved", "ok");

    const { data: noNote } = await admin.rpc("admin_suspend_mentor", {
      p_actor: adminActor.id,
      p_mentor_user_id: m.id,
      p_note: "   ",
    });
    expect(noNote?.[0]?.ok, "a suspension with no real note must be refused").toBe(false);
    expect(noNote?.[0]?.reason).toBe("reason_required");

    const { data, error } = await admin.rpc("admin_suspend_mentor", {
      p_actor: adminActor.id,
      p_mentor_user_id: m.id,
      p_note: "Missed three sessions without notice.",
    });
    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(true);

    const { data: row } = await admin
      .from("mentor_profiles")
      .select("status, review_note, reviewed_by")
      .eq("user_id", m.id)
      .single();
    expect(row?.status).toBe("suspended");
    expect(row?.review_note).toBe("Missed three sessions without notice.");
    expect(row?.reviewed_by).toBe(adminActor.id);
  });

  it("refuses to fire from any status other than approved", async () => {
    const pending = await makeMentor("pending", "pending");
    const rejected = await makeMentor("rejected", "rejected");
    const alreadySuspended = await makeMentor("suspended", "already");

    for (const m of [pending, rejected, alreadySuspended]) {
      const { data } = await admin.rpc("admin_suspend_mentor", {
        p_actor: adminActor.id,
        p_mentor_user_id: m.id,
        p_note: "reason",
      });
      expect(data?.[0]?.ok, `STATE-MACHINE BUG: suspended a mentor whose status was not 'approved'`).toBe(false);
      expect(data?.[0]?.reason).toBe("not_approved");
    }
  });

  it("refuses an actor with no mentor_review permission", async () => {
    const m = await makeMentor("approved", "noperm");
    const { data } = await admin.rpc("admin_suspend_mentor", {
      p_actor: noPermActor.id,
      p_mentor_user_id: m.id,
      p_note: "reason",
    });
    expect(data?.[0]?.ok, "PERMISSION BUG: an actor with no mentor_review permission suspended a mentor").toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");

    const { data: row } = await admin.from("mentor_profiles").select("status").eq("user_id", m.id).single();
    expect(row?.status).toBe("approved");
  });

  it("two concurrent suspend calls on the same approved mentor: exactly one succeeds", async () => {
    const m = await makeMentor("approved", "race");

    const [r1, r2] = await Promise.all([
      raceA.rpc("admin_suspend_mentor", { p_actor: adminActor.id, p_mentor_user_id: m.id, p_note: "race A" }),
      raceB.rpc("admin_suspend_mentor", { p_actor: adminActor.id, p_mentor_user_id: m.id, p_note: "race B" }),
    ]);

    const oks = [r1.data?.[0]?.ok, r2.data?.[0]?.ok].filter(Boolean);
    expect(oks.length, "STATE-MACHINE BUG: both concurrent suspend calls reported success").toBe(1);

    const { data: row } = await admin.from("mentor_profiles").select("status").eq("user_id", m.id).single();
    expect(row?.status).toBe("suspended");
  });
});

describe("admin_reinstate_mentor", () => {
  it("reinstates a SUSPENDED mentor, admin-only, no note required", async () => {
    const m = await makeMentor("suspended", "reinstate-ok");

    const { data, error } = await admin.rpc("admin_reinstate_mentor", {
      p_actor: adminActor.id,
      p_mentor_user_id: m.id,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(true);

    const { data: row } = await admin.from("mentor_profiles").select("status").eq("user_id", m.id).single();
    expect(row?.status).toBe("approved");
  });

  it("refuses to fire from any status other than suspended", async () => {
    const approved = await makeMentor("approved", "reinstate-approved");
    const pending = await makeMentor("pending", "reinstate-pending");

    for (const m of [approved, pending]) {
      const { data } = await admin.rpc("admin_reinstate_mentor", { p_actor: adminActor.id, p_mentor_user_id: m.id });
      expect(data?.[0]?.ok, "STATE-MACHINE BUG: reinstated a mentor who was not 'suspended'").toBe(false);
      expect(data?.[0]?.reason).toBe("not_suspended");
    }
  });

  it("refuses an actor with no mentor_review permission", async () => {
    const m = await makeMentor("suspended", "reinstate-noperm");
    const { data } = await admin.rpc("admin_reinstate_mentor", { p_actor: noPermActor.id, p_mentor_user_id: m.id });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
  });
});

describe("the self-pause / admin-suspend interaction — 0174's own stated trap", () => {
  it("a mentor cannot unpause their way around an admin suspension", async () => {
    const m = await makeMentor("approved", "trap");

    // Confirmed publicly visible while approved and not paused.
    const before = await createAuthedTestUser("trap-outsider-before");
    try {
      const { data: seenBefore } = await before.client
        .from("mentor_profiles")
        .select("user_id")
        .eq("user_id", m.id)
        .maybeSingle();
      expect(seenBefore?.user_id).toBe(m.id);
    } finally {
      await deleteTestUsers([before.id]);
    }

    const { data: suspendResult } = await admin.rpc("admin_suspend_mentor", {
      p_actor: adminActor.id,
      p_mentor_user_id: m.id,
      p_note: "for-cause suspension",
    });
    expect(suspendResult?.[0]?.ok).toBe(true);

    // THE TRAP: the mentor sets self_paused = false as themselves — the only
    // column their own grant lets them move. If visibility were ever
    // wired as an OR instead of an AND, or if any read site forgot the
    // second condition, this would silently undo the suspension.
    const { error: selfPauseError } = await m.client
      .from("mentor_profiles")
      .update({ self_paused: false })
      .eq("user_id", m.id);
    expect(selfPauseError, "0174's own grant must let a mentor write self_paused").toBeNull();

    const { data: rowAfter } = await admin
      .from("mentor_profiles")
      .select("status, self_paused")
      .eq("user_id", m.id)
      .single();
    expect(rowAfter?.self_paused, "the mentor's own write must have applied").toBe(false);
    expect(
      rowAfter?.status,
      "SECURITY HOLE: a mentor's self_paused write flipped status back to approved",
    ).toBe("suspended");

    // The actual assertion that matters: still invisible, because
    // visibility is `status = 'approved' AND NOT self_paused`, and status is
    // still 'suspended' regardless of self_paused's value.
    const outsider = await createAuthedTestUser("trap-outsider-after");
    try {
      const { data: seenAfter } = await outsider.client
        .from("mentor_profiles")
        .select("user_id")
        .eq("user_id", m.id)
        .maybeSingle();
      expect(
        seenAfter,
        "SECURITY HOLE: an admin-suspended mentor became publicly visible again after unpausing self_paused",
      ).toBeNull();
    } finally {
      await deleteTestUsers([outsider.id]);
    }

    // And separately: even now, the mentor still cannot write status
    // directly to undo the suspension the more obvious way (extends the
    // same column-privilege assertion tests/rls/mentorship.test.ts already
    // makes for the approved case, proving it still holds while suspended).
    const { error: statusWriteError } = await m.client
      .from("mentor_profiles")
      .update({ status: "approved" })
      .eq("user_id", m.id);
    expect(statusWriteError, "COLUMN-PRIVILEGE BUG: a suspended mentor rewrote their own status").not.toBeNull();

    const { data: stillSuspended } = await admin.from("mentor_profiles").select("status").eq("user_id", m.id).single();
    expect(stillSuspended?.status).toBe("suspended");
  });
});
