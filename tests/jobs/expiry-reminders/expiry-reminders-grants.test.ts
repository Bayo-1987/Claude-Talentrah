/**
 * The AUTHENTICATED half of the grant check for migration 0207: a signed-in employer, however legitimate, must not be
 * able to call any of the closing-reminder functions or read the reminder table. (The anon half, and everything else,
 * is expiry-reminders-db.test.ts.)
 *
 * CI-BOUND. It needs a real authenticated session (tests/support/auth.ts's sessionFor), which cannot be minted against
 * a hosted project from a developer machine (the JWT key does not match). The same SQL behaviour was verified on the
 * test project with `set local role authenticated` inside a rolled-back transaction; see the PR description.
 *
 * Why it matters: Postgres grants EXECUTE on a new function to PUBLIC by default, and revoking from `anon` and
 * `authenticated` alone leaves that in place. These functions can mark a posting reminded and extend its closing date.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../../support/auth";
import { deleteTestOrgs } from "../../support/cleanup";

let userId = "";
let orgId = "";
let jobId = "";
let client: DB;

beforeAll(async () => {
  const user = await createTestUser("expiryrem-grants");
  userId = user.id;
  client = await sessionFor(user.email, user.id);

  // An employer with an organisation and a posting of their own, for the closing_date_source checks below.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `EMPLOYER-TEST expiry-grants ${randomUUID()}`, created_by: userId, verified: false })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;
  await admin.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "EXPIRYREM Grants Co",
      title: `EXPIRYREM Grants ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting owned by expiry-reminders-grants.test.ts.",
      structured_jd: {},
      status: "draft",
      expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`fixture posting: ${jobError?.message}`);
  jobId = job.id;
}, 60_000);

afterAll(async () => {
  if (jobId) await admin.from("job_postings").delete().eq("id", jobId);
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteTestOrgs([orgId]);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

const now = new Date("2030-06-15T19:00:00.000Z").toISOString();
const CALLS: Array<[string, Record<string, unknown>]> = [
  ["expiry_reminder_window_ok", { p_closes_at: now, p_now: now }],
  ["due_job_expiry_reminders", { p_now: now, p_limit: 5 }],
  ["claim_job_expiry_reminder", { p_job_posting_id: randomUUID(), p_token_hash: "x", p_now: now }],
  ["redeem_job_expiry_extend_token", { p_token_hash: "x", p_now: now }],
  ["job_expiry_function_definition", { p_name: "redeem_job_expiry_extend_token" }],
];

describe("an authenticated user", () => {
  it.each(CALLS)("calling %s is refused with permission denied (42501)", async (fn, args) => {
    const res = await client.rpc(fn as never, args as never);
    expect(res.error, `${fn} must not be callable by an authenticated user`).not.toBeNull();
    expect(res.error!.code).toBe("42501");
  });

  it("cannot read job_expiry_reminders: an error, or nothing", async () => {
    const res = await client.from("job_expiry_reminders").select("*");
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
  });

  it("cannot insert into it either", async () => {
    const res = await client
      .from("job_expiry_reminders")
      .insert({ job_posting_id: randomUUID(), closes_at: now, token_hash: randomUUID() });
    expect(res.error).not.toBeNull();
  });
});

describe("closing_date_source: an employer cannot write it, so they cannot spoof 'default'", () => {
  it("cannot set it on their own posting (the column is not UPDATE-granted)", async () => {
    const res = await client.from("job_postings").update({ closing_date_source: "default" }).eq("id", jobId).select("id");
    expect(res.error, "an UPDATE of the column must be refused, not silently ignored").not.toBeNull();
    const { data } = await admin.from("job_postings").select("closing_date_source").eq("id", jobId).single();
    expect(data!.closing_date_source).toBeNull();
  });

  it("cannot smuggle it in with a new posting either (the INSERT is a table-level grant; the guard trigger refuses)", async () => {
    const res = await client.from("job_postings").insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "EXPIRYREM Grants Co",
      title: `EXPIRYREM Grants insert ${randomUUID().slice(0, 8)}`,
      description: "Should never be created.",
      structured_jd: {},
      status: "draft",
      dedup_fingerprint: randomUUID(),
      closing_date_source: "default",
    });
    expect(res.error).not.toBeNull();
  });

  it("can still read it", async () => {
    const res = await client.from("job_postings").select("closing_date_source").eq("id", jobId);
    expect(res.error).toBeNull();
  });

  it("can still change the DATE itself (their own column), which is why the source is guarded", async () => {
    const res = await client
      .from("job_postings")
      .update({ expires_at: new Date(Date.now() + 25 * 86_400_000).toISOString() })
      .eq("id", jobId)
      .select("id");
    expect(res.error).toBeNull();
  });
});

