/**
 * Saving tracker notes reports what happened.
 *
 * The action was a fire-and-forget `.update()`: no `.select()`, no error
 * check, no row count. A Supabase update that is REFUSED resolves with an
 * `error` rather than throwing, so every failure looked like success and the
 * page revalidated the OLD value as though it were saved.
 *
 * The reported symptom did not reproduce. Three causes were ruled out against
 * production before writing this: the `applications` policy is owner-only for
 * ALL and correct; `notes` carries an UPDATE grant to `authenticated`; and the
 * 0037 terminal-stage trigger early-returns when the stage is unchanged, so
 * notes on a hired application are not blocked by it.
 *
 * These tests therefore pin the INSTRUMENT, not a diagnosis:
 *
 *   1. A real save actually lands and is readable back.
 *   2. A save aimed at someone else's row does not silently claim success —
 *      it must not write, and the action must not pretend it did.
 *   3. Notes survive on a `hired` application, which is the one stage a
 *      trigger could plausibly have blocked. Asserted because it was the
 *      leading hypothesis and it was wrong; a future change to that trigger
 *      could make it right.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

let owner: Awaited<ReturnType<typeof createAuthedTestUser>>;
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;
let appId: string;

beforeAll(async () => {
  owner = await createAuthedTestUser("notes-owner");
  stranger = await createAuthedTestUser("notes-stranger");

  const { data, error } = await admin
    .from("applications")
    .insert({
      user_id: owner.id,
      job_posting_id: null,
      manual_job_snapshot: { companyName: "NOTES-TEST Co", title: "NOTES-TEST Role" },
      stage: "applied",
      source: "manual",
      applied_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture application: ${error?.message}`);
  appId = data.id;
});

afterAll(async () => {
  // A refused delete resolves with an error rather than throwing.
  const { error } = await admin.from("applications").delete().eq("id", appId);
  if (error) console.error("[notes cleanup]", error.message);
  await deleteTestUsers([owner.id, stranger.id]);
});

const notesOf = async (id: string) => {
  const { data } = await admin.from("applications").select("notes, stage").eq("id", id).single();
  return data!;
};

describe("a save that works, works", () => {
  it("writes the note and returns the row, so the action can tell", async () => {
    const { data, error } = await owner.client
      .from("applications")
      .update({ notes: "NOTES-TEST: recruiter call Thursday 2pm." })
      .eq("id", appId)
      .eq("user_id", owner.id)
      .select("id");

    expect(error).toBeNull();
    // The row count is the whole point — this is what the action now checks.
    expect(data).toHaveLength(1);
    expect((await notesOf(appId)).notes).toContain("Thursday");
  });

  it("clears the note when the field is emptied", async () => {
    const { data, error } = await owner.client
      .from("applications")
      .update({ notes: null })
      .eq("id", appId)
      .eq("user_id", owner.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await notesOf(appId)).notes).toBeNull();
  });
});

describe("a save that does not work says so", () => {
  it("a stranger's write matches zero rows rather than succeeding quietly", async () => {
    await admin.from("applications").update({ notes: "NOTES-TEST: owner's own." }).eq("id", appId);

    const { data, error } = await stranger.client
      .from("applications")
      .update({ notes: "NOTES-TEST: not yours." })
      .eq("id", appId)
      .eq("user_id", stranger.id)
      .select("id");

    // A row-policy denial is silent: no error, zero rows. Only the length
    // distinguishes it from success, which is exactly why the old code — with
    // neither check — could not.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
    expect((await notesOf(appId)).notes).toContain("owner's own");
  });

  it("and so does a write against an id that no longer exists", async () => {
    const { data, error } = await owner.client
      .from("applications")
      .update({ notes: "NOTES-TEST: ghost." })
      .eq("id", randomUUID())
      .eq("user_id", owner.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("the hypothesis that was wrong, pinned so it stays wrong", () => {
  it("notes still save on a hired application", async () => {
    /*
     * The leading guess was that 0037's terminal-stage trigger fires on any
     * update to a hired row, because `new.stage <> 'archived'` is true when
     * the stage is unchanged. It does not: the function early-returns on
     * `old.stage is not distinct from new.stage`. If that early return is ever
     * removed, notes on hired applications break silently — this catches it.
     */
    await admin.from("applications").update({ stage: "hired" }).eq("id", appId);

    const { data, error } = await owner.client
      .from("applications")
      .update({ notes: "NOTES-TEST: start date confirmed." })
      .eq("id", appId)
      .eq("user_id", owner.id)
      .select("id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const row = await notesOf(appId);
    expect(row.stage).toBe("hired");
    expect(row.notes).toContain("start date");
  });
});
