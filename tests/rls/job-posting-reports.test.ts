/**
 * `job_posting_reports` (0057) — write-only, and one per person per posting.
 *
 * A report is an accusation against a named company written by a named user.
 * Both halves are sensitive and the pairing is more so, which is why the table
 * is locked the same way `feedback` is: SELECT/UPDATE/DELETE revoked as
 * PRIVILEGES rather than merely left unpolicied. A missing policy is undone by
 * adding one; a missing grant has to be restored on purpose, in SQL, in a
 * diff.
 *
 * THE UNIQUE CONSTRAINT IS NOT HOUSEKEEPING. The operator queue on
 * /api/admin/moderate-job-posting ranks postings by report count, and an
 * operator deciding whether to pull an employer's listing needs that number to
 * mean "twelve people" and not "one person, twelve times". Without the
 * constraint the count is an applause meter and the loudest complainer decides
 * who gets removed. It is also the reason the action does no
 * "have you already reported this?" read: it could not (no SELECT), and two
 * quick taps would both pass such a check anyway. The constraint is the check.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let alice: Awaited<ReturnType<typeof createAuthedTestUser>>;
let bob: Awaited<ReturnType<typeof createAuthedTestUser>>;
let jobId: string;
let otherJobId: string;

async function makePosting(title: string) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "REPORTS-TEST Co",
      title,
      description: "Fixture posting owned by tests/rls/job-posting-reports.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: `reports-test-${randomUUID()}`,
      external_source: "reports-test",
      external_url: `https://example.test/${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  alice = await createAuthedTestUser("report-alice");
  bob = await createAuthedTestUser("report-bob");
  jobId = await makePosting("REPORTS-TEST Scam Role");
  otherJobId = await makePosting("REPORTS-TEST Other Role");
});

afterAll(async () => {
  // Reports cascade from the posting, but check the posting delete itself: a
  // refused delete resolves with an error rather than throwing.
  const { error } = await admin.from("job_postings").delete().in("id", [jobId, otherJobId]);
  if (error) console.error("[reports cleanup]", error.message);
  await deleteTestUsers([alice.id, bob.id]);
});

describe("reporting works, once, and only in your own name", () => {
  it("a signed-in seeker can report a posting", async () => {
    const { error } = await alice.client.from("job_posting_reports").insert({
      job_posting_id: jobId,
      reporter_id: alice.id,
      reason: "scam",
      details: "REPORTS-TEST: asks for a training fee up front.",
    });
    expect(error).toBeNull();
  });

  it("the same person cannot report the same posting twice", async () => {
    const { error } = await alice.client.from("job_posting_reports").insert({
      job_posting_id: jobId,
      reporter_id: alice.id,
      reason: "other",
    });
    expect(error).not.toBeNull();
    // 23505 specifically — the action branches on this code to answer "you've
    // already reported this" rather than apologising for a failure.
    expect(error!.code).toBe("23505");
  });

  it("but a different person can report the same posting", async () => {
    const { error } = await bob.client.from("job_posting_reports").insert({
      job_posting_id: jobId,
      reporter_id: bob.id,
      reason: "closed_but_listed",
    });
    expect(error).toBeNull();

    const { count } = await admin
      .from("job_posting_reports")
      .select("id", { count: "exact", head: true })
      .eq("job_posting_id", jobId);
    // The number an operator acts on: two PEOPLE, not three clicks.
    expect(count).toBe(2);
  });

  it("and the same person can report a different posting", async () => {
    const { error } = await alice.client.from("job_posting_reports").insert({
      job_posting_id: otherJobId,
      reporter_id: alice.id,
      reason: "discriminatory",
    });
    expect(error).toBeNull();
  });

  it("cannot report in someone else's name", async () => {
    const { error } = await bob.client.from("job_posting_reports").insert({
      job_posting_id: otherJobId,
      reporter_id: alice.id,
      reason: "scam",
      details: "REPORTS-TEST: forged.",
    });
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("job_posting_reports")
      .select("id", { count: "exact", head: true })
      .ilike("details", "%forged%");
    expect(count).toBe(0);
  });

  it("refuses whitespace-only details, which read as though something was said", async () => {
    const { error } = await bob.client.from("job_posting_reports").insert({
      job_posting_id: otherJobId,
      reporter_id: bob.id,
      reason: "other",
      details: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("but accepts no details at all", async () => {
    const { error } = await bob.client
      .from("job_posting_reports")
      .insert({ job_posting_id: otherJobId, reporter_id: bob.id, reason: "other", details: null });
    expect(error).toBeNull();
  });

  it("a signed-out visitor cannot report anything", async () => {
    const { error } = await anon
      .from("job_posting_reports")
      .insert({ job_posting_id: jobId, reporter_id: alice.id, reason: "scam" });
    expect(error).not.toBeNull();
  });
});

describe("who accused whom is not readable by anyone signed in", () => {
  it("SELECT is REFUSED, not merely empty — including for your own report", async () => {
    // A revoked privilege errors; a policy matching no rows returns []. Only
    // the first keeps the table shut if someone later adds a policy.
    const { data, error } = await alice.client.from("job_posting_reports").select("*");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("a signed-out visitor cannot read it either", async () => {
    const { error } = await anon.from("job_posting_reports").select("*");
    expect(error).not.toBeNull();
  });

  it("an insert that asks for the row back is refused — RETURNING needs SELECT", async () => {
    // Pins the action's shape: chaining .select() would fail AFTER the write,
    // telling the reporter it failed when it landed.
    const { error } = await bob.client
      .from("job_posting_reports")
      .insert({ job_posting_id: jobId, reporter_id: bob.id, reason: "scam" })
      .select("id");
    expect(error).not.toBeNull();
  });

  it("UPDATE and DELETE are both refused", async () => {
    const { error: updateErr } = await alice.client
      .from("job_posting_reports")
      .update({ reason: "other" })
      .eq("job_posting_id", jobId);
    expect(updateErr).not.toBeNull();

    const { error: deleteErr } = await alice.client
      .from("job_posting_reports")
      .delete()
      .eq("job_posting_id", jobId);
    expect(deleteErr).not.toBeNull();

    const { count } = await admin
      .from("job_posting_reports")
      .select("id", { count: "exact", head: true })
      .eq("job_posting_id", jobId);
    expect(count).toBe(2);
  });
});

describe("POSITIVE CONTROL: the operator can read the queue", () => {
  it("otherwise reporting is a hole rather than a channel", async () => {
    const { data, error } = await admin
      .from("job_posting_reports")
      .select("reason, details, job_postings(title)")
      .eq("job_posting_id", jobId);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});
