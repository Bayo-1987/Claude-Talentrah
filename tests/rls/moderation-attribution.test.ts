/**
 * 0064's attribution columns.
 *
 * `scholarships.moderated_by` and `job_postings.removed_by` answer "WHICH
 * operator decided this" — the question all three moderation routes documented
 * themselves as unable to answer, because a shared secret proves "an operator"
 * and not "which one". Now that a real answer is written, two properties have
 * to hold or the column is worse than the honest null it replaced:
 *
 *   1. It must not be settable to an arbitrary id. A column that can name
 *      anyone is a forgery surface, not an audit trail — and the FK to
 *      `profiles` is what enforces it.
 *   2. It must not be writable by a normal session. A value that asserts WHO
 *      DID SOMETHING is exactly the class CLAUDE.md says needs a grant rather
 *      than a policy; four live findings here came from that distinction.
 *
 * Both are asserted against the real database rather than read off the
 * migration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

let seeker: Awaited<ReturnType<typeof createAuthedTestUser>>;
let scholarshipId: string | null = null;

/*
 * THIS SUITE CREATES ITS OWN LISTING, and the first version did not — it took
 * `select id from scholarships limit 1` and mutated whatever it found.
 *
 * That was wrong in a way that only shows up under load, which is the worst
 * kind. Every suite here runs against one shared project, in parallel, and
 * alongside other sessions' CI runs; a test that writes to an arbitrary row it
 * did not create is coupled to every other suite that reads the catalog, and
 * the failure surfaces somewhere unrelated as a value that changed underneath
 * an assertion. This repo has a whole file of scar tissue about exactly that
 * shape (tests/support/global-teardown.ts).
 *
 * It also meant a real catalog row carried a test user's id in `moderated_by`
 * for the duration of the run.
 *
 * Own fixture, deleted afterwards, identified by a fingerprint nothing else
 * can collide with.
 */
const FIXTURE_FINGERPRINT = `modattr-${randomUUID()}`;

beforeAll(async () => {
  seeker = await createAuthedTestUser("modattr");

  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: "MODATTR-TEST Provider",
      program_name: "MODATTR-TEST Programme",
      funding_type: "full",
      official_url: "https://example.test/modattr",
      dedup_fingerprint: FIXTURE_FINGERPRINT,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not create the fixture listing: ${error.message}`);
  scholarshipId = data.id;
});

afterAll(async () => {
  // Checked, not fire-and-forget: a rejected Supabase delete RESOLVES with an
  // error (CLAUDE.md), so an unchecked one would report a cleanup that never
  // happened and leave a fixture listing in the catalog.
  const { error } = await admin
    .from("scholarships")
    .delete()
    .eq("dedup_fingerprint", FIXTURE_FINGERPRINT);
  if (error) console.warn(`[cleanup] fixture scholarship survived: ${error.message}`);
  await deleteTestUsers([seeker.id]);
});

describe("moderated_by / removed_by cannot name someone who does not exist", () => {
  it("refuses an id with no matching profile", async () => {
    if (!scholarshipId) return expect(scholarshipId).toBeNull(); // nothing seeded; nothing to assert

    const { error } = await admin
      .from("scholarships")
      .update({ moderated_by: randomUUID() })
      .eq("id", scholarshipId);

    // 23503 = foreign_key_violation. Without the FK this update would succeed
    // and the column would happily record a reviewer who has never existed.
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("accepts a real profile id", async () => {
    if (!scholarshipId) return expect(scholarshipId).toBeNull();

    const { error } = await admin
      .from("scholarships")
      .update({ moderated_by: seeker.id })
      .eq("id", scholarshipId);
    expect(error).toBeNull();

    const { data } = await admin
      .from("scholarships")
      .select("moderated_by")
      .eq("id", scholarshipId)
      .single();
    expect(data?.moderated_by).toBe(seeker.id);
  });
});

describe("a normal session cannot write either column", () => {
  it("refuses a seeker setting scholarships.moderated_by", async () => {
    if (!scholarshipId) return expect(scholarshipId).toBeNull();

    const { error } = await seeker.client
      .from("scholarships")
      .update({ moderated_by: seeker.id })
      .eq("id", scholarshipId);

    /*
     * A refusal here can arrive two ways and the difference matters: a REVOKED
     * PRIVILEGE raises an error, while a row policy that matches nothing
     * returns success and affects zero rows. Assert the error, then re-read
     * with the service role — because only the second check distinguishes
     * "refused" from "silently did nothing", and a future permissive policy
     * would turn the first into a false pass.
     */
    expect(error).not.toBeNull();

    const { data } = await admin
      .from("scholarships")
      .select("moderated_by")
      .eq("id", scholarshipId)
      .single();
    // Still whatever the previous test set, never rewritten by the seeker.
    expect(data?.moderated_by).toBe(seeker.id);
  });

  it("refuses a seeker setting job_postings.removed_by", async () => {
    const { data: posting } = await admin
      .from("job_postings")
      .select("id, removed_by")
      .limit(1)
      .maybeSingle();
    if (!posting) return expect(posting).toBeNull();

    const { error } = await seeker.client
      .from("job_postings")
      .update({ removed_by: seeker.id })
      .eq("id", posting.id);
    expect(error).not.toBeNull();

    const { data: after } = await admin
      .from("job_postings")
      .select("removed_by")
      .eq("id", posting.id)
      .single();
    expect(after?.removed_by).toBe(posting.removed_by);
  });
});
