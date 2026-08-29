/**
 * 0065's triage columns, and the hole adding them nearly opened.
 *
 * `feedback` is a write-only mailbox (0054): SELECT/UPDATE/DELETE revoked, one
 * INSERT policy checking `user_id = auth.uid()`. Adding `status` and
 * `triaged_by` did not threaten the read side — UPDATE was already revoked, so
 * the new columns inherited that.
 *
 * INSERT was the exposure, and it is the verb none of 0026/0027/0028/0030/0064
 * were about. `authenticated` held INSERT on the WHOLE TABLE, and the policy
 * only constrains WHO you file as, never WHICH COLUMNS you may set — a policy
 * cannot do the second thing. So without 0065's per-column grant, any signed-in
 * user could file a report that arrived already `resolved`, signed with another
 * person's id, and it would be indistinguishable from a real triage decision
 * because those columns are the only record of one.
 *
 * That is what the first suite here proves is refused. Every assertion is
 * about the PRIVILEGE, so it keeps failing if someone widens the grant, rather
 * than passing because a policy happens to block the same thing today.
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

let alice: Awaited<ReturnType<typeof createAuthedTestUser>>;
let rowId: string;

beforeAll(async () => {
  alice = await createAuthedTestUser("fbtriage");

  // Filed the ordinary way, through a real session, so the row under test is
  // one the product actually produces.
  const { error } = await alice.client.from("feedback").insert({
    user_id: alice.id,
    category: "bug",
    message: "FEEDBACK-TRIAGE-TEST: the export produced a blank PDF.",
  });
  if (error) throw new Error(`Alice could not file feedback: ${error.message}`);

  const { data } = await admin
    .from("feedback")
    .select("id")
    .eq("user_id", alice.id)
    .single();
  rowId = data!.id;
});

afterAll(async () => {
  // The row cascades with the account, but delete explicitly so a failure to
  // clean up is visible here rather than inferred.
  const { error } = await admin.from("feedback").delete().eq("user_id", alice.id);
  if (error) console.warn(`[cleanup] feedback rows survived: ${error.message}`);
  await deleteTestUsers([alice.id]);
});

describe("a user cannot forge a triage record while filing", () => {
  it("refuses an insert that sets status", async () => {
    const { error } = await alice.client.from("feedback").insert({
      user_id: alice.id,
      category: "bug",
      message: "FEEDBACK-TRIAGE-TEST: pre-resolved.",
      status: "resolved",
    });
    // A column-level privilege denial, not a policy denial: the policy would
    // have accepted this row happily.
    expect(error, "a user could set status on insert — the per-column grant is gone").not.toBeNull();
  });

  it("refuses an insert that names a triaging admin", async () => {
    const { error } = await alice.client.from("feedback").insert({
      user_id: alice.id,
      category: "bug",
      message: "FEEDBACK-TRIAGE-TEST: signed by someone else.",
      triaged_by: alice.id,
    });
    expect(error).not.toBeNull();
  });

  it("refuses an insert that back-dates itself", async () => {
    const { error } = await alice.client.from("feedback").insert({
      user_id: alice.id,
      category: "idea",
      message: "FEEDBACK-TRIAGE-TEST: time traveller.",
      created_at: "2020-01-01T00:00:00Z",
    });
    expect(error).not.toBeNull();
  });

  it("still accepts an ordinary submission", async () => {
    // The grant must not be so narrow that it breaks the feature it protects.
    // src/lib/feedback/actions.ts sends exactly these four columns.
    const { error } = await alice.client.from("feedback").insert({
      user_id: alice.id,
      category: "other",
      message: "FEEDBACK-TRIAGE-TEST: an ordinary one.",
      page_path: "/jobs",
    });
    expect(error).toBeNull();
  });
});

describe("the triage columns stay unreachable after the fact", () => {
  it("a signed-in user cannot update status, and the row is unchanged", async () => {
    const { error } = await alice.client
      .from("feedback")
      .update({ status: "resolved" })
      .eq("id", rowId);
    expect(error).not.toBeNull();

    // A refused privilege errors; a policy denial silently affects zero rows.
    // Only re-reading with the service role tells those apart from success.
    const { data } = await admin.from("feedback").select("status").eq("id", rowId).single();
    expect(data?.status).toBe("new");
  });

  it("a signed-out visitor cannot insert or read", async () => {
    const insert = await anon.from("feedback").insert({
      user_id: alice.id,
      category: "bug",
      message: "FEEDBACK-TRIAGE-TEST: from nobody.",
    });
    expect(insert.error).not.toBeNull();

    const read = await anon.from("feedback").select("status, triaged_by").limit(1);
    expect(read.error).not.toBeNull();
    expect(read.data).toBeNull();
  });

  it("a signed-in user still cannot read the queue they are in", async () => {
    // 0054's central claim, re-asserted against the new columns specifically:
    // triage state is not a back door into the mailbox.
    const { data, error } = await alice.client.from("feedback").select("status").limit(1);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe("a triaged row must name an operator", () => {
  it("refuses a status change that leaves triaged_by null", async () => {
    // The service role can write these columns; the CHECK is what stops it
    // writing them incoherently. Without it, `status` and `triaged_by` could
    // disagree and nothing would notice until someone asked who closed it.
    const { error } = await admin
      .from("feedback")
      .update({ status: "resolved" })
      .eq("id", rowId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/feedback_triaged_rows_name_an_operator/);
  });

  it("accepts one that does", async () => {
    const { error } = await admin
      .from("feedback")
      .update({ status: "resolved", triaged_by: alice.id, triaged_at: new Date().toISOString() })
      .eq("id", rowId);
    expect(error).toBeNull();
  });
});
