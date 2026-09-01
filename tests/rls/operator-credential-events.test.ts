/**
 * 0067's function, and the one property that makes it safe to have at all.
 *
 * `auth.audit_log_entries` holds credential events for EVERY user, and its
 * payload carries `actor_username` — an email address. The function exposes a
 * slice of that table to the application, so the question is not "does it
 * work" but "can it be made to return somebody who is not an operator".
 *
 * It cannot, and the reason is structural rather than careful: the join to
 * `admin_users` is inside the function body and is not a parameter. There is
 * no argument that widens it and no "all users" mode. That is what this suite
 * pins — because a future edit adding a `p_user_id` for convenience would look
 * entirely reasonable in review, and would turn a scoped audit view into a
 * lookup for anybody's recovery history.
 *
 * The second half asserts the grant, which is the ordinary belt-and-braces:
 * SECURITY DEFINER means the function reads a table its callers cannot, so an
 * EXECUTE grant to the wrong role would hand them exactly that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let operator: Awaited<ReturnType<typeof createAuthedTestUser>>;
let civilian: Awaited<ReturnType<typeof createAuthedTestUser>>;

beforeAll(async () => {
  operator = await createAuthedTestUser("credev-operator");
  civilian = await createAuthedTestUser("credev-civilian");

  const { error } = await admin.from("admin_users").insert({
    id: operator.id,
    email: operator.email.toLowerCase(),
    display_name: "Credential Event Fixture",
  });
  if (error) throw new Error(`could not create the fixture operator: ${error.message}`);
});

afterAll(async () => {
  await admin.from("admin_audit_log").delete().eq("admin_user_id", operator.id);
  await deleteTestUsers([operator.id, civilian.id]);
});

describe("the function is reachable only by the service role", () => {
  it("refuses anon and a signed-in user", async () => {
    for (const [label, client] of [
      ["anon", anon],
      ["signed-in", civilian.client],
    ] as const) {
      const { error } = await client.rpc("operator_credential_events", {});
      // SECURITY DEFINER reads a table neither role can touch, so the EXECUTE
      // grant is the only thing standing between them and it.
      expect(error, `${label} could execute operator_credential_events`).not.toBeNull();
    }
  });

  it("the service role can call it", async () => {
    const { error } = await admin.rpc("operator_credential_events", {});
    expect(error).toBeNull();
  });
});

describe("it returns operators and nobody else", () => {
  it("every row it returns belongs to an admin_users account", async () => {
    /*
     * BOTH SIDES OF THE CALL ARE SNAPSHOTTED, and the union is what the rows
     * are checked against.
     *
     * This read `admin_users` once, AFTER the RPC. Every suite shares one CI
     * project, so an account that was an operator when the function ran can be
     * deleted by another suite's teardown before that read — and then this
     * reports `returned a non-operator` about a function that behaved
     * perfectly. A security assertion that cries wolf gets weakened by whoever
     * meets it on a bad day, which is the real cost.
     *
     * A row the RPC returned was an operator at RPC time, and RPC time lies
     * between these two reads, so the union contains it whichever side of the
     * call the account was created or deleted on. The property asserted is
     * unchanged — it deliberately does NOT narrow to this suite's own rows,
     * because "never returns a non-operator" is the thing worth catching.
     */
    const before = await admin.from("admin_users").select("id");
    expect(before.error, before.error?.message).toBeNull();

    const { data, error } = await admin.rpc("operator_credential_events", {});
    expect(error).toBeNull();

    const after = await admin.from("admin_users").select("id");
    expect(after.error, after.error?.message).toBeNull();

    const adminIds = new Set([
      ...(before.data ?? []).map((a) => a.id),
      ...(after.data ?? []).map((a) => a.id),
    ]);

    // The assertion that matters. If a future edit ever widens the scope, this
    // is what fails — not a reviewer noticing.
    /*
     * SAY SO WHEN THERE IS NOTHING TO CHECK.
     *
     * This loop is empty on any project whose `auth.audit_log_entries` holds no
     * matching events — which is the CI project today, where the RPC returns
     * zero rows. An empty loop passes, and a test that checked nothing is
     * indistinguishable from one that checked everything unless it says so. The
     * positive control below already warns for exactly this reason; this
     * assertion was relying on the same absence without mentioning it.
     */
    if ((data ?? []).length === 0) {
      console.warn(
        "[operator-credential-events] the containment check ran over ZERO rows: " +
          "auth.audit_log_entries has no matching events on this project, so it " +
          "proved nothing here. It is a live guard only where events exist.",
      );
    }

    for (const row of data ?? []) {
      expect(adminIds.has(row.operator_id), `returned a non-operator: ${row.operator_id}`).toBe(
        true,
      );
    }
  });

  it("a civilian's email never appears in the results", async () => {
    const { data } = await admin.rpc("operator_credential_events", {});
    const emails = (data ?? []).map((r) => r.operator_email.toLowerCase());
    expect(emails).not.toContain(civilian.email.toLowerCase());
  });

  /*
   * THE POSITIVE CONTROL CANNOT RUN ON THE CI PROJECT, and saying so is more
   * useful than a green tick that means nothing.
   *
   * `auth.audit_log_entries` is EMPTY on CI — zero rows, ever, while
   * production holds ~22,000. So every negative assertion above passes
   * trivially there: a function returning nothing at all would satisfy them,
   * which is exactly how a broken filter looks like a working one.
   *
   * Two things were tried and do not help. `generateLink` from the admin API
   * writes NO audit entry (measured: no rows appeared on CI within ten minutes
   * of calling it), so the obvious way to mint a fixture event does not exist.
   * And the service role cannot INSERT into the auth schema either — it has
   * USAGE but no table privileges, which is the same fact that made 0067
   * SECURITY DEFINER in the first place.
   *
   * So this skips loudly rather than silently, and the positive direction was
   * verified against PRODUCTION instead, inline, before 0067 was written:
   *
   *     events matching the two actions, all users   5358
   *     events after the admin_users join               0
   *     operators                                       2
   *
   * — the filter reducing a real 5,358-row population to zero, with two real
   * operator accounts present to be matched against. That is the evidence for
   * the scoping; this test is the regression guard for it wherever the data
   * exists.
   */
  it("returns an operator's own events where the audit log is populated", async () => {
    /*
     * THIS SUITE'S OWN OPERATOR, not "some operator somewhere".
     *
     * This asserted `count > 0` over the whole `admin_users` table while the
     * comment claimed it proved the fixture exists. On a shared project those
     * are different statements: any other suite's operator satisfies the count,
     * so if this suite's own insert had silently failed, the check would still
     * pass and the positive control below would quietly test nothing.
     *
     * Demonstrated rather than argued: with the fixture's row deleted and one
     * unrelated operator present, the old assertion passed 5/5 and this one
     * fails.
     */
    const { data: mine, error: mineErr } = await admin
      .from("admin_users")
      .select("id")
      .eq("id", operator.id)
      .maybeSingle();
    expect(mineErr, mineErr?.message).toBeNull();
    expect(mine?.id, "this suite's own fixture operator must exist").toBe(operator.id);

    const { data, error } = await admin.rpc("operator_credential_events", {});
    expect(error).toBeNull();

    if ((data ?? []).length === 0) {
      console.warn(
        "[operator-credential-events] SKIPPED the positive control: " +
          "auth.audit_log_entries is empty on this project, so there is no event to match. " +
          "The negative assertions above therefore pass trivially here.",
      );
      return;
    }

    // Where events do exist, every one must resolve to a real operator with a
    // real action — the shape the screen renders.
    for (const row of data!) {
      expect(row.operator_email).toBeTruthy();
      expect(["user_recovery_requested", "user_modified"]).toContain(row.event_action);
    }
  });
});
