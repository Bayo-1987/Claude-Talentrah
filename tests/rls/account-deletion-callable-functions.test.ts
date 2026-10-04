/**
 * ACCT-1 PR 1 follow-up — the five 0212 functions any SIGNED-IN user can call, and exactly what each one tells a caller who is not the account's owner.
 *
 *   account_deletion_status / account_deletion_restore   take NO user id: they act on auth.uid() and nothing else. Signed in as A, they see and change only A.
 *   account_is_active / application_applicant_is_active / submission_applicant_is_active
 *                        RLS policies call these AS THE CALLER, so `authenticated` must keep EXECUTE (revoking it would break the mentor, assessment and
 *                        applicant policies for everyone). They answer one question, "is this person hidden?", and the answer is `false` ONLY for an
 *                        account that has confirmed a deletion. For a nonexistent id they answer `true`, exactly as for an active account, so they reveal
 *                        NOTHING about whether an id exists.
 *
 * WHAT THIS PINS, ON PURPOSE: a signed-in caller who already holds another person's account, application or submission id can learn from these three
 * whether that person has a deletion pending. That is a known, deliberate consequence of letting policies call them (see the PR body for the options); this
 * test makes any change to it a decision rather than an accident. `anon` can call none of them (tests/rls/account-deletion-function-grants.test.ts).
 *
 * First run of this file is CI (no database on the authoring machine); the same calls were run in a rolled-back transaction on talentrah-preview.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
const as = (u: Authed) => u.client as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }> };

let a: Authed; // the caller
let b: Authed; // the person whose deletion is pending
let c: Authed; // an ordinary active person
let orgId = "";
const resumeIds: string[] = [];
let appB = "";
let appC = "";
const unknownId = randomUUID();

async function makeApplication(owner: Authed, jobId: string): Promise<string> {
  const resume = await admin.from("resumes").insert({ user_id: owner.id, structured_content: { contact: { name: "Fixture" }, summary: "Fixture.", experience: [], education: [], skills: ["sql"] } }).select("id").single();
  if (resume.error || !resume.data) throw new Error(`fixture resume: ${resume.error?.message}`);
  resumeIds.push(resume.data.id);
  const app = await admin.from("applications").insert({ user_id: owner.id, job_posting_id: jobId, resume_id: resume.data.id, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
  if (app.error || !app.data) throw new Error(`fixture application: ${app.error?.message}`);
  return app.data.id;
}

beforeAll(async () => {
  [a, b, c] = await Promise.all([createAuthedTestUser("acct1c-caller"), createAuthedTestUser("acct1c-pending"), createAuthedTestUser("acct1c-active")]);
  const org = await admin.from("organizations").insert({ name: `ACCT1-TEST Org callable ${randomUUID().slice(0, 8)}`, created_by: a.id, verified: true }).select("id, name").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  const job = await admin.from("job_postings").insert({ source_type: "internal", organization_id: orgId, company_name: org.data.name, title: `ACCT1-TEST Role ${randomUUID().slice(0, 6)}`, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() }).select("id").single();
  if (job.error || !job.data) throw new Error(`fixture job: ${job.error?.message}`);
  appB = await makeApplication(b, job.data.id);
  appC = await makeApplication(c, job.data.id);

  // B has confirmed a deletion: the request row the way account_deletion_confirm leaves it, and the flag.
  const req = await admin.from("account_deletions" as never).insert({ profile_id: b.id, status: "scheduled", token_hash: randomUUID().replace(/-/g, "").padEnd(64, "0"), token_expires_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), hard_delete_after: new Date(Date.now() + 29 * 86_400_000).toISOString(), credits_forfeited: 0 } as never);
  if (req.error) throw new Error(`fixture request: ${req.error.message}`);
  const flag = await admin.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", b.id);
  if (flag.error) throw new Error(`fixture flag: ${flag.error.message}`);
}, 240_000);

afterAll(async () => {
  for (const u of [a, b, c]) if (u) await admin.from("account_deletions" as never).delete().eq("profile_id", u.id);
  for (const id of [appB, appC]) if (id) await admin.from("applications").delete().eq("id", id);
  if (resumeIds.length) await admin.from("resumes").delete().in("id", resumeIds);
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers([a, b, c].filter(Boolean).map((u) => u.id));
}, 120_000);

/*
 * NOT VACUOUS. Every assertion below is about what a SIGNED-IN caller sees, so first prove the sessions are real and are who they claim to be. An anonymous
 * client would be refused outright (42501), but a session that resolved to the wrong person, or to nobody, could make "A sees nothing of B" pass for the wrong
 * reason. `account_deletion_status()` with no `auth.uid()` also answers `{scheduled: false}`, so a "false" for A alone proves nothing: the contrast with B's own
 * "true" does. If the sessions cannot be minted, beforeAll throws and the file FAILS; it is never skipped.
 */
describe("the sessions are real, and each is who it says it is", () => {
  it("A can read A's own profile and cannot read B's (owner-only RLS resolves the token to A)", async () => {
    const own = await a.client.from("profiles").select("id").eq("id", a.id);
    expect(own.error).toBeNull();
    expect(own.data?.map((r) => r.id)).toEqual([a.id]);
    const other = await a.client.from("profiles").select("id").eq("id", b.id);
    expect(other.data ?? []).toEqual([]);
  });

  it("B's session resolves to B (it can read B's own profile)", async () => {
    const own = await b.client.from("profiles").select("id").eq("id", b.id);
    expect(own.data?.map((r) => r.id)).toEqual([b.id]);
  });

  it("A and B are different people with different answers to the same call (so 'A sees nothing' is not an empty fixture)", async () => {
    expect(a.id).not.toBe(b.id);
    const asA = (await as(a).rpc("account_deletion_status")).data;
    const asB = (await as(b).rpc("account_deletion_status")).data;
    expect(asA).toEqual({ scheduled: false });
    expect(asB).toMatchObject({ scheduled: true });
  });

  it("the fixtures are what the rest of the file assumes: B is flagged, C is not, both applications exist", async () => {
    const { data } = await admin.from("profiles").select("id, deletion_requested_at").in("id", [b.id, c.id]);
    const byId = new Map((data ?? []).map((r) => [r.id, r.deletion_requested_at]));
    expect(byId.get(b.id)).not.toBeNull();
    expect(byId.get(c.id)).toBeNull();
    const apps = await admin.from("applications").select("id").in("id", [appB, appC]);
    expect(apps.data).toHaveLength(2);
  });
});

describe("status and restore act only on the caller", () => {
  it("A, with nothing scheduled, sees nothing scheduled, and B's pending deletion is not visible through status", async () => {
    const { data, error } = await as(a).rpc("account_deletion_status");
    expect(error).toBeNull();
    expect(data).toEqual({ scheduled: false });
  });

  it("B sees their own scheduled deletion", async () => {
    const { data } = await as(b).rpc("account_deletion_status");
    expect(data).toMatchObject({ scheduled: true });
  });

  it("A calling restore has nothing to restore, and B's deletion is untouched", async () => {
    const { data, error } = await as(a).rpc("account_deletion_restore");
    expect(error).toBeNull();
    expect(data).toEqual({ ok: false, reason: "nothing_to_restore" });
    const { data: profile } = await admin.from("profiles").select("deletion_requested_at").eq("id", b.id).single();
    expect(profile?.deletion_requested_at, "B's flag must survive A's restore call").not.toBeNull();
    const { data: row } = await admin.from("account_deletions" as never).select("status").eq("profile_id", b.id).single();
    expect((row as unknown as { status: string }).status).toBe("scheduled");
  });

  it("neither function accepts a user id to act on (an extra argument is not honoured)", async () => {
    const { error } = await as(a).rpc("account_deletion_restore", { p_user_id: b.id });
    expect(error, "PostgREST finds no function with that signature").not.toBeNull();
    const { data: profile } = await admin.from("profiles").select("deletion_requested_at").eq("id", b.id).single();
    expect(profile?.deletion_requested_at).not.toBeNull();
  });
});

describe("the three is_active helpers: what a signed-in caller can learn", () => {
  it("account_is_active: false only for the account with a pending deletion; true for an active account AND for an id that does not exist", async () => {
    expect((await as(a).rpc("account_is_active", { p_user_id: b.id })).data).toBe(false);
    expect((await as(a).rpc("account_is_active", { p_user_id: c.id })).data).toBe(true);
    expect((await as(a).rpc("account_is_active", { p_user_id: unknownId })).data).toBe(true);
  });

  it("application_applicant_is_active: the same shape, by application id", async () => {
    expect((await as(a).rpc("application_applicant_is_active", { p_application_id: appB })).data).toBe(false);
    expect((await as(a).rpc("application_applicant_is_active", { p_application_id: appC })).data).toBe(true);
    expect((await as(a).rpc("application_applicant_is_active", { p_application_id: unknownId })).data).toBe(true);
  });

  it("submission_applicant_is_active: an id that does not exist answers true, like an active applicant", async () => {
    expect((await as(a).rpc("submission_applicant_is_active", { p_submission_id: unknownId })).data).toBe(true);
  });

  it("no one learns whether an id EXISTS: a real active id and an invented one answer identically", async () => {
    const real = (await as(a).rpc("account_is_active", { p_user_id: c.id })).data;
    const invented = (await as(a).rpc("account_is_active", { p_user_id: unknownId })).data;
    expect(real).toBe(invented);
  });

  it("the answer never carries anything but a boolean (no date, no reason)", async () => {
    for (const [fn, args] of [["account_is_active", { p_user_id: b.id }], ["application_applicant_is_active", { p_application_id: appB }]] as const) {
      const { data } = await as(a).rpc(fn, args as never);
      expect(typeof data).toBe("boolean");
    }
  });
});
