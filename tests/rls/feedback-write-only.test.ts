/**
 * `feedback` is a write-only mailbox (0054), and this suite is what makes that
 * claim mean something.
 *
 * WHY WRITE-ONLY AT ALL. Feedback is other people's words about the product,
 * their employer, and sometimes us. There is no signed-in user who should be
 * able to read another's, and the only reason to grant SELECT would be to let
 * someone re-read their own — a convenience that costs a SELECT grant, after
 * which the table's privacy depends entirely on nobody ever writing a wrong
 * policy.
 *
 * WHY THE GRANTS AND NOT JUST THE POLICIES. This is the distinction that has
 * produced four live findings here (0026, 0027, 0028, 0030): a policy decides
 * WHICH ROWS, a grant decides WHICH VERBS. Supabase gives `authenticated` and
 * `anon` `ALL ON ALL TABLES` in public by default, so a table with no SELECT
 * policy is unreadable only until someone adds one. 0054 revokes the
 * privilege, so restoring readability takes deliberate SQL in a diff.
 *
 * The two denials look different and both are asserted, because confusing them
 * is how a hole gets called a pass: a REVOKED PRIVILEGE raises an error, while
 * a policy that matches no rows returns an empty array and no error. A test
 * that only checked `data` would pass on both — including on the version where
 * the privilege is back and a future policy is one line away from exposing
 * every row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

let alice: Awaited<ReturnType<typeof createAuthedTestUser>>;
let bob: Awaited<ReturnType<typeof createAuthedTestUser>>;
let aliceRowId: string;

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

beforeAll(async () => {
  alice = await createAuthedTestUser("feedback-alice");
  bob = await createAuthedTestUser("feedback-bob");

  const { error } = await alice.client.from("feedback").insert({
    user_id: alice.id,
    category: "bug",
    message: "FEEDBACK-TEST: the resume export produced a blank PDF twice.",
  });
  if (error) throw new Error(`Alice could not file her own feedback: ${error.message}`);

  // Read back with the service role — nobody else can, which is the point.
  const { data, error: readErr } = await admin
    .from("feedback")
    .select("id")
    .eq("user_id", alice.id)
    .single();
  if (readErr || !data) throw new Error(`Could not locate Alice's row: ${readErr?.message}`);
  aliceRowId = data.id;
});

afterAll(async () => {
  // ON DELETE CASCADE from profiles takes the feedback with the user, but say
  // so rather than assume it: a delete that is REFUSED resolves with an error
  // instead of throwing, which is how rows have leaked here before.
  const { error } = await admin.from("feedback").delete().eq("user_id", alice.id);
  if (error) console.error("[feedback cleanup]", error.message);
  await deleteTestUsers([alice.id, bob.id]);
});

describe("filing works, and only in your own name", () => {
  it("a signed-in user can file feedback", async () => {
    const { error } = await bob.client.from("feedback").insert({
      user_id: bob.id,
      category: "idea",
      message: "FEEDBACK-TEST: let me filter the feed by salary.",
    });
    expect(error).toBeNull();
  });

  it("but cannot file it in someone else's name", async () => {
    const { error } = await bob.client.from("feedback").insert({
      user_id: alice.id,
      category: "other",
      message: "FEEDBACK-TEST: forged, and should never land.",
    });
    // The INSERT policy's `with check`, not application code.
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", alice.id)
      .ilike("message", "%forged%");
    expect(count).toBe(0);
  });

  it("but an insert that asks for the row back is refused — SELECT is part of RETURNING", async () => {
    /*
     * The coupling between the lockdown and the call shape, pinned.
     *
     * PostgREST asks for a representation whenever `.select()` is chained, and
     * `INSERT ... RETURNING` needs SELECT on the returned columns. With SELECT
     * revoked, that fails 42501 AFTER the row is written — a submission the
     * user is told failed and which actually landed. src/lib/feedback/actions.ts
     * therefore inserts without `.select()`, and this is what would catch
     * someone adding one back.
     */
    const { error } = await bob.client
      .from("feedback")
      .insert({ user_id: bob.id, category: "other", message: "FEEDBACK-TEST: wants a receipt." })
      .select("id");
    expect(error).not.toBeNull();
  });

  it("refuses a blank message at the database, not just in the form", async () => {
    const { error } = await bob.client
      .from("feedback")
      .insert({ user_id: bob.id, category: "bug", message: "   " });
    expect(error).not.toBeNull();
  });

  it("a signed-out visitor cannot file anything", async () => {
    const { error } = await anon
      .from("feedback")
      .insert({ user_id: alice.id, category: "bug", message: "FEEDBACK-TEST: anonymous." });
    expect(error).not.toBeNull();
  });
});

describe("nobody signed in can read it back — including its author", () => {
  it("SELECT is REFUSED, not merely empty", async () => {
    const { data, error } = await alice.client.from("feedback").select("*");
    // The distinction that matters: a revoked privilege errors. An empty array
    // with no error would mean the grant is back and only a policy is holding.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("and cannot be reached by asking for its own row by id", async () => {
    const { error } = await alice.client.from("feedback").select("*").eq("id", aliceRowId);
    expect(error).not.toBeNull();
  });

  it("a signed-out visitor cannot read it either", async () => {
    const { error } = await anon.from("feedback").select("*");
    expect(error).not.toBeNull();
  });
});

describe("and nobody signed in can change or destroy it", () => {
  it("UPDATE is refused, and the row is unchanged", async () => {
    const { error } = await alice.client
      .from("feedback")
      .update({ message: "FEEDBACK-TEST: rewritten." })
      .eq("id", aliceRowId);
    expect(error).not.toBeNull();

    const { data } = await admin.from("feedback").select("message").eq("id", aliceRowId).single();
    expect(data!.message).toContain("blank PDF");
  });

  it("DELETE is refused, and the row survives", async () => {
    const { error } = await alice.client.from("feedback").delete().eq("id", aliceRowId);
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("id", aliceRowId);
    expect(count).toBe(1);
  });
});

describe("POSITIVE CONTROL: the service role can still read the mailbox", () => {
  it("otherwise the table is a write-only hole, not a mailbox", async () => {
    const { data, error } = await admin
      .from("feedback")
      .select("id, category, message, page_path, created_at")
      .eq("id", aliceRowId)
      .single();
    expect(error).toBeNull();
    expect(data!.category).toBe("bug");
    expect(data!.page_path).toBeNull();
  });
});
