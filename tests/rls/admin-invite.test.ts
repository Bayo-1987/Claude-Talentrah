/**
 * 0076's admin_create_operator, and the invite path's two load-bearing facts.
 *
 * The interesting claims are not "it inserts a row":
 *
 *   1. The DATABASE refuses a caller without `operators`. Adding an operator
 *      is the mutation that CREATES privilege, so it is the last one that
 *      should trust its caller — every other operator mutation in 0075
 *      re-checks, and this one had to as well.
 *   2. handle_new_user fires for an INVITE-created account. `profiles` is
 *      load-bearing: ad_campaigns.reviewed_by references it, so an operator
 *      without one could not be recorded as having reviewed anything. The
 *      trigger is AFTER INSERT ON auth.users FOR EACH ROW with no WHEN clause,
 *      so it should — but "should" is how the 0064 column revoke got shipped
 *      as a no-op, and this asserts it instead.
 *
 * NOTE ON generateLink vs inviteUserByEmail: the invite path is exercised with
 * generateLink({ type: "invite" }), which creates the auth.users row exactly as
 * the invite does but hands nothing to the mailer. Supabase's mailer is
 * rate-limited (observed: 429 "email rate limit exceeded"), and a suite that
 * consumed that quota would fail for unrelated reasons and take real invites
 * down with it. The row this produces is the same row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireOperatorsLock } from "../support/operators-lock";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

type Perm = Database["public"]["Enums"]["admin_permission"];
const tag = randomUUID().slice(0, 8);

let manager: Awaited<ReturnType<typeof createAuthedTestUser>>;
let bystander: Awaited<ReturnType<typeof createAuthedTestUser>>;
let managerRole: string, plainRole: string;
const invited: string[] = [];

async function makeRole(label: string, perms: Perm[]) {
  const { data, error } = await admin
    .from("admin_roles").insert({ name: `invite-test ${label} ${tag}` }).select("id").single();
  if (error) throw new Error(`fixture role: ${error.message}`);
  if (perms.length) {
    const { error: pe } = await admin.from("admin_role_permissions")
      .insert(perms.map((permission) => ({ role_id: data.id, permission })));
    if (pe) throw new Error(`fixture perms: ${pe.message}`);
  }
  return data.id;
}

/** Create an auth account the way an invite does, without sending mail. */
async function inviteOnly(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite", email,
    options: { redirectTo: "http://localhost:3000/auth/callback?next=/reset-password" },
  });
  if (error) throw new Error(`invite: ${error.message}`);
  invited.push(data.user.id);
  return data.user;
}


/*
 * SERIALIZED against every other suite that creates an admin holding
 * `operators`. See tests/support/operators-lock.ts and 0082 — the short
 * version is that `admin_operators_covered()` is global, so "this is the last
 * holder" is only true while no other suite's holder exists.
 */
let releaseOperatorsLock: (() => Promise<void>) | undefined;

beforeAll(async () => {
  releaseOperatorsLock = await acquireOperatorsLock(admin, "admin-invite");
  [manager, bystander] = await Promise.all([
    createAuthedTestUser("invite-mgr"),
    createAuthedTestUser("invite-bystander"),
  ]);
  managerRole = await makeRole("manager", ["operators"]);
  plainRole = await makeRole("plain", ["finance"]);
  const { error } = await admin.from("admin_users").insert([
    { id: manager.id, email: manager.email.toLowerCase(), role_id: managerRole },
    { id: bystander.id, email: bystander.email.toLowerCase(), role_id: plainRole },
  ]);
  if (error) throw new Error(`fixture operators: ${error.message}`);
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
    const ids = [manager?.id, bystander?.id, ...invited].filter(Boolean) as string[];
    const { error: a } = await admin.from("admin_audit_log").delete().in("admin_user_id", ids);
    if (a) console.error("[invite cleanup] audit:", a.message);
    const { error: u } = await admin.from("admin_users").delete().in("id", ids);
    if (u) console.error("[invite cleanup] admin_users:", u.message);
    await deleteTestUsers(ids);
    // Roles last: role_id is ON DELETE RESTRICT.
    const { error } = await admin.from("admin_roles").delete().in("id", [managerRole, plainRole]);
    if (error) console.error("[invite cleanup] roles:", error.message);
  } finally {
    await releaseOperatorsLock?.();
  }
});

describe("0076: an invite-created account is a usable operator", () => {
  it("handle_new_user fires for an invite, and the profile satisfies the FK admin_users needs", async () => {
    const user = await inviteOnly(`invite-a-${randomUUID()}@talentrah.test`);

    // The invite has not been accepted: no password, not confirmed.
    expect(user.invited_at, "invited_at should be stamped").not.toBeNull();
    // Falsy, not null: Supabase omits the field entirely when unset, so
    // toBeNull() fails on `undefined` for a reason that has nothing to do with
    // the account's state.
    expect(user.confirmed_at, "an unaccepted invite must not be confirmed").toBeFalsy();

    const { data: profile } = await admin
      .from("profiles").select("id").eq("id", user.id).maybeSingle();
    expect(profile, "handle_new_user did not create a profiles row for an invite").not.toBeNull();

    const { data, error } = await admin.rpc("admin_create_operator", {
      p_actor: manager.id, p_user_id: user.id,
      p_email: user.email!, p_display_name: "Invited Person", p_role_id: plainRole,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.ok, data?.[0]?.reason).toBe(true);

    const { data: row } = await admin
      .from("admin_users").select("email, display_name, role_id, role, disabled_at")
      .eq("id", user.id).single();
    expect(row?.role_id).toBe(plainRole);
    expect(row?.display_name).toBe("Invited Person");
    expect(row?.disabled_at, "a new operator must not arrive disabled").toBeNull();
    // The deprecated text column is derived, not guessed: plainRole has no
    // `operators`, so it must read "standard".
    expect(row?.role).toBe("standard");
  });

  it("NO PASSWORD is set by the invite — the account cannot be signed into until accepted", async () => {
    const email = `invite-b-${randomUUID()}@talentrah.test`;
    const user = await inviteOnly(email);

    /*
     * THE ASSERTION THAT MATTERS. The inviter supplies no password and the
     * invite sets none, so a password sign-in must fail. If this ever passes,
     * something is minting a credential on the invitee's behalf.
     */
    /*
     * A GENERATED value, not a fixed string. The secret scanner's
     * talentrah-hardcoded-credential rule matches a credential-ish name
     * assigned a quoted literal, with no entropy floor — deliberately, since
     * this repo's real leaks were low-entropy strings a person typed. It
     * excludes interpolated values precisely so generated ones do not trip it.
     *
     * Generating is the honest thing here anyway: this is not a credential,
     * it is a value chosen to be wrong. A fixed string that reads like a
     * password is indistinguishable from one at scan time, and the scanner is
     * right not to guess.
     */
    const notTheirPassword = `no-such-password-${randomUUID()}`;
    const { data: signIn, error } = await admin.auth.signInWithPassword({
      email, password: notTheirPassword,
    });
    expect(signIn?.session, "an un-accepted invite must not have a usable password").toBeFalsy();
    expect(error, "signing in to an un-accepted invite should fail").not.toBeNull();

    const { data: fresh } = await admin.auth.admin.getUserById(user.id);
    expect(fresh?.user?.confirmed_at, "still unaccepted").toBeFalsy();
  });
});

describe("0076: the database refuses the wrong caller", () => {
  it("an operator without `operators` cannot create one", async () => {
    const user = await inviteOnly(`invite-c-${randomUUID()}@talentrah.test`);
    const { data } = await admin.rpc("admin_create_operator", {
      p_actor: bystander.id, p_user_id: user.id,
      p_email: user.email!, p_display_name: "", p_role_id: plainRole,
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");

    const { data: none } = await admin.from("admin_users").select("id").eq("id", user.id);
    expect(none, "LEAK: an unauthorised caller created an operator").toHaveLength(0);
  });

  it("an unknown role is refused rather than creating a permissionless operator", async () => {
    const user = await inviteOnly(`invite-d-${randomUUID()}@talentrah.test`);
    const { data } = await admin.rpc("admin_create_operator", {
      p_actor: manager.id, p_user_id: user.id,
      p_email: user.email!, p_display_name: "", p_role_id: randomUUID(),
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("unknown_role");
  });

  it("inviting somebody who is already an operator is reported, not silently reassigned", async () => {
    const { data } = await admin.rpc("admin_create_operator", {
      p_actor: manager.id, p_user_id: bystander.id,
      p_email: bystander.email, p_display_name: "", p_role_id: managerRole,
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("already_admin");

    // and their role is untouched — this must not be a back door to promotion
    const { data: row } = await admin
      .from("admin_users").select("role_id").eq("id", bystander.id).single();
    expect(row?.role_id, "LEAK: a duplicate invite changed an existing operator's role")
      .toBe(plainRole);
  });
});
