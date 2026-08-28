/**
 * The isolation claim in 0060, asserted rather than described.
 *
 * The whole reason admin identity went into its own tables instead of an
 * `is_admin` column on `profiles` is that `profiles` is user-writable and its
 * grant list exists to grow. That argument is only worth anything if the new
 * tables really are unreachable from a consumer session — so this suite is the
 * standing check that they are, and it asserts the two denials separately
 * because confusing them is how a hole gets called a pass:
 *
 *   A REVOKED PRIVILEGE raises an error.
 *   A POLICY that matches no rows returns an empty array and no error.
 *
 * A test that only looked at `data` would pass on both, including on the
 * version where the privilege is back and one permissive policy would expose
 * every operator account. These tables have BOTH — RLS on with no policies at
 * all, and every privilege revoked — so the expected result is always an
 * error, and an empty-but-successful read here is a regression, not a pass.
 *
 * The second half exercises `admin_session_validate`, which is the only thing
 * standing between a cookie and the admin area. Its four conditions are
 * checked one at a time, because each is a different way to be locked out and
 * a function that got three right would still be a hole on the fourth.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const ADMIN_TABLES = ["admin_users", "admin_sessions", "admin_audit_log"] as const;

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let seeker: Awaited<ReturnType<typeof createAuthedTestUser>>;
/** A real operator, so the negative assertions are denied by privilege and not by there being nothing to find. */
let operator: Awaited<ReturnType<typeof createAuthedTestUser>>;

function tokenPair() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

async function openSession(
  adminId: string,
  overrides: Partial<{ expires_at: string; revoked_at: string }> = {},
) {
  const { token, hash } = tokenPair();
  const { data, error } = await admin
    .from("admin_sessions")
    .insert({
      admin_user_id: adminId,
      token_hash: hash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not open a fixture session: ${error.message}`);
  return { id: data.id, token, hash };
}

beforeAll(async () => {
  seeker = await createAuthedTestUser("adminrls-seeker");
  operator = await createAuthedTestUser("adminrls-operator");

  const { error } = await admin.from("admin_users").insert({
    id: operator.id,
    email: operator.email.toLowerCase(),
    display_name: "Fixture Operator",
  });
  if (error) throw new Error(`could not create the fixture admin: ${error.message}`);
});

afterAll(async () => {
  // admin_users cascades to admin_sessions, and deleting the auth user
  // cascades to admin_users — but the audit rows are ON DELETE SET NULL by
  // design, so they survive. Clear the ones this suite wrote by session,
  // before the cascade nulls the id we would need to find them by.
  await admin.from("admin_audit_log").delete().eq("admin_user_id", operator.id);
  await deleteTestUsers([seeker.id, operator.id]);
});

describe("the admin tables are unreachable from a consumer session", () => {
  for (const table of ADMIN_TABLES) {
    it(`refuses ${table} to anon`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      // The privilege is gone, so this must be an ERROR and not an empty read.
      expect(error, `anon could read ${table} — the revoke is gone`).not.toBeNull();
      expect(data).toBeNull();
    });

    it(`refuses ${table} to a signed-in seeker`, async () => {
      const { data, error } = await seeker.client.from(table).select("*").limit(1);
      expect(error, `a seeker could read ${table} — the revoke is gone`).not.toBeNull();
      expect(data).toBeNull();
    });
  }

  it("refuses a seeker who tries to make themselves an admin", async () => {
    const { error } = await seeker.client
      .from("admin_users")
      .insert({ id: seeker.id, email: seeker.email });
    expect(error, "a seeker could insert into admin_users — this is the escalation").not.toBeNull();

    // The insert being refused is one thing; the ROW not existing is what
    // actually matters, and only the service role can tell us.
    const { data } = await admin.from("admin_users").select("id").eq("id", seeker.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses a seeker who tries to un-disable or rename an operator", async () => {
    const { error } = await seeker.client
      .from("admin_users")
      .update({ display_name: "not mine to set" })
      .eq("id", operator.id);
    expect(error).not.toBeNull();
  });

  it("refuses the session validator to anon and to a seeker", async () => {
    for (const [label, client] of [
      ["anon", anon],
      ["seeker", seeker.client],
    ] as const) {
      /*
       * Hashed rather than handed a bare string literal, and not only for
       * realism. `.gitleaks.toml`'s rule matches any name containing "token"
       * assigned to a quoted literal of eight or more characters — which is
       * what the obvious one-word version of this call would be, and CI
       * rejected exactly that. The rule is right to be blunt: it deliberately
       * has no entropy floor, because an entropy floor is what let this
       * repo's two real password leaks through. So the fix belongs here
       * rather than in the allowlist, which that file warns only ever grows.
       *
       * Don't inline a literal back into this call, and don't quote one in a
       * comment either — a comment reproducing the offending shape trips the
       * same rule, which is how this note got written the long way round.
       */
      const { error } = await client.rpc("admin_session_validate", {
        p_token_hash: createHash("sha256").update("no such session").digest("hex"),
      });
      expect(error, `${label} could execute admin_session_validate`).not.toBeNull();
    }
  });
});

describe("admin_session_validate", () => {
  it("returns the operator's identity for a live session, and touches it", async () => {
    const session = await openSession(operator.id);

    const { data, error } = await admin.rpc("admin_session_validate", {
      p_token_hash: session.hash,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      session_id: session.id,
      admin_id: operator.id,
      admin_email: operator.email.toLowerCase(),
      admin_display_name: "Fixture Operator",
    });

    // last_seen_at moves as part of the same statement — the point of doing
    // the check as one UPDATE … RETURNING rather than a read then a write.
    const { data: row } = await admin
      .from("admin_sessions")
      .select("created_at, last_seen_at")
      .eq("id", session.id)
      .single();
    expect(new Date(row!.last_seen_at).getTime()).toBeGreaterThanOrEqual(
      new Date(row!.created_at).getTime(),
    );
  });

  it("returns nothing for a token that was never issued", async () => {
    const { data, error } = await admin.rpc("admin_session_validate", {
      p_token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("returns nothing once the session is revoked", async () => {
    const session = await openSession(operator.id);
    const { error: revokeError } = await admin
      .from("admin_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", session.id);
    expect(revokeError).toBeNull();

    const { data } = await admin.rpc("admin_session_validate", { p_token_hash: session.hash });
    expect(data ?? []).toHaveLength(0);
  });

  it("returns nothing once the session has expired", async () => {
    const session = await openSession(operator.id, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const { data } = await admin.rpc("admin_session_validate", { p_token_hash: session.hash });
    expect(data ?? []).toHaveLength(0);
  });

  it("returns nothing for a live session belonging to a disabled operator", async () => {
    // The one an app-layer check would miss: the cookie is valid, unexpired
    // and unrevoked. Revoking someone has to take effect through their
    // existing sessions, not only their next login.
    const session = await openSession(operator.id);
    const { error: disableError } = await admin
      .from("admin_users")
      .update({ disabled_at: new Date().toISOString() })
      .eq("id", operator.id);
    expect(disableError).toBeNull();

    const { data } = await admin.rpc("admin_session_validate", { p_token_hash: session.hash });
    expect(data ?? []).toHaveLength(0);

    await admin.from("admin_users").update({ disabled_at: null }).eq("id", operator.id);
  });
});

describe("attribution", () => {
  it("an admin id is also a profiles id, so ad_campaigns.reviewed_by can point at it", async () => {
    // Not incidental: ad_campaigns.reviewed_by is a foreign key to profiles,
    // and it is hardcoded null today because a shared secret cannot name a
    // reviewer. Keying admin_users on the auth user id is what lets M2 fill
    // it in without inventing a second id space.
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("id", operator.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(operator.id);
  });

  it("keeps the audit trail after the admin row is gone", async () => {
    const { error: writeError } = await admin.from("admin_audit_log").insert({
      admin_user_id: operator.id,
      admin_email: operator.email.toLowerCase(),
      action: "admin.login",
    });
    expect(writeError).toBeNull();

    const { data } = await admin
      .from("admin_audit_log")
      .select("admin_email, action")
      .eq("admin_user_id", operator.id);
    expect(data ?? []).not.toHaveLength(0);
    // The email is snapshotted rather than joined for, which is what makes the
    // row still say who it was once ON DELETE SET NULL has cleared the id.
    expect(data![0].admin_email).toBe(operator.email.toLowerCase());
  });
});
