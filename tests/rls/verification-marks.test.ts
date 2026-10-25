/**
 * VERIFY-1 marks foundation (migration 0266). DATABASE-BACKED, CI ONLY (needs minted sessions and the migrated schema). Written before the migration and red without it (there is no verification_marks table
 * and no employer_visible_marks / applicant_visible_marks function). The same cases, plus the backfill parity and ten mutants of the migration, were also run against a local copy of the real schema
 * (reports/S3-21/raw/0241/standin-proof.out), because the backfill happens once, at apply time, and a CI database has nothing to backfill; the migration's own self-check holds parity at apply time.
 *
 *   PARITY (as far as CI can see it): a review that passes through resolve_talent_verification awards exactly one resume_reviewed mark whose date is the date the profile shows and whose review type is the attempt's;
 *     a failed review awards none; resolving twice awards one.
 *   NO SCORE: the table has no score-like column, and nothing in what a client can read carries one.
 *   GRANTS: anon reads nothing; a signed-in user reads only their own rows and only the listed columns (not the resume hash, not the source row); nobody but the server writes.
 *   QA: a QA account's mark is returned by neither read function.
 *   EXPIRY: the liveness rule is tested with an injected clock at the expiry instant -1 s, 0 and +1 s; a mark that expired is not returned, one expiring later is.
 *   CHANGED SINCE REVIEW: false after the review, false after a no-op or key-order change, true after a real edit, false again after a re-review.
 *   GATES: the directory read needs an ACTIVE, unexpired subscription and the listing gate; the applicants read needs membership of the job's organisation and an application, and ignores the directory opt-in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin as typedAdmin, deleteTestUsers, sessionFor } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const admin = typedAdmin as unknown as SupabaseClient;
type Authed = { id: string; email: string; client: Awaited<ReturnType<typeof sessionFor>> };
const as = (a: Authed) => a.client as unknown as SupabaseClient;
/**
 * NOT POOLED, on purpose. createAuthedTestUser hands out a reused identity from test_user_pool and releases it afterwards, and service_role cannot delete from verification_marks (SELECT and INSERT only, by design), so
 * marks written for a pooled identity would stay on it for ever and break the next run that claimed it (4, 6 and 2 failures on three re-runs of this file on one database). These users are plain auth users created here and
 * removed with deleteTestUsers, which deletes them; their marks go with them (verification_marks.user_id references profiles on delete cascade), and afterAll checks that nothing is left.
 */
async function createUnpooledAuthedUser(prefix: string): Promise<Authed> {
  const email = `${prefix}-${randomUUID()}@talentrah.test`;
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await typedAdmin.auth.admin.createUser({ email, email_confirm: true });
    if (!error && data.user) return { id: data.user.id, email, client: await sessionFor(email, data.user.id) };
    if (attempt < 4 && error && /rate limit/i.test(error.message)) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    throw new Error(`createUser ${email}: ${error?.message ?? "no user returned"}`);
  }
}
const tag = randomUUID().slice(0, 6);

type MarkRow = { candidate_id: string; mark_type: string; field: string | null; level: string | null; review_type: string | null; earned_at: string; expires_at: string; changed_since_review: boolean };
const CONTRACT_KEYS = ["candidate_id", "changed_since_review", "earned_at", "expires_at", "field", "level", "mark_type", "review_type"];
/** The applicants read is keyed by APPLICATION and carries no user id at all (employer_job_applicants returns none either: 0125/0126). */
const APPLICANT_KEYS = ["application_id", "changed_since_review", "earned_at", "expires_at", "field", "level", "mark_type", "review_type"];
type AppMarkRow = Omit<MarkRow, "candidate_id"> & { application_id: string };

const userIds: string[] = [];
const orgIds: string[] = [];
let cand: Authed; // an ordinary verified, opted-in candidate with a base resume
let candOptOut: Authed; // verified, NOT opted in (applicant only)
let candQa: Authed; // a QA account (by name), verified, opted in
let candQaPlus: Authed; // a QA account by the 0251 rule: the owner's stonebridgehibr1+<tag>@gmail.com address on the profile; verified, opted in
let employer: Authed; // member of the subscribed organisation (owner of the job)
let employerNoSub: Authed; // member of an organisation without a subscription
let jobId: string;
const appOf: Record<string, string> = {}; // user id -> application id on the job
let resumeId: string;

async function pending(userId: string, type: "ai" | "human" = "ai") {
  const { data, error } = await admin.from("talent_verifications").insert({ user_id: userId, status: "pending", review_type: type }).select("id").single();
  expect(error, error?.message).toBeNull();
  return data!.id as string;
}
async function resolve(verificationId: string, userId: string, verified: boolean) {
  const { data, error } = await admin.rpc("resolve_talent_verification", { p_verification_id: verificationId, p_user_id: userId, p_verified: verified, p_score: verified ? 88 : 10, p_feedback: "test", p_reviewer_id: null, p_reviewer_notes: null });
  expect(error, error?.message).toBeNull();
  return data as unknown as boolean;
}
async function marksOf(userId: string) {
  const { data, error } = await admin.from("verification_marks").select("id, mark_type, review_type, earned_at, expires_at, resume_hash, source_id").eq("user_id", userId).order("earned_at");
  expect(error, error?.message).toBeNull();
  return data ?? [];
}
async function directory(client: Authed, ids: string[]): Promise<{ rows: MarkRow[]; error: string | null }> {
  const { data, error } = await as(client).rpc("employer_visible_marks", { p_candidate_ids: ids });
  return { rows: (data ?? []) as MarkRow[], error: error?.message ?? null };
}
async function applicants(client: Authed): Promise<{ rows: AppMarkRow[]; error: string | null }> {
  const { data, error } = await as(client).rpc("applicant_visible_marks", { p_job_posting_id: jobId });
  return { rows: (data ?? []) as AppMarkRow[], error: error?.message ?? null };
}
const appIdsOf = (...users: Authed[]) => users.map((u) => appOf[u.id]).sort();

beforeAll(async () => {
  [cand, candOptOut, candQa, candQaPlus, employer, employerNoSub] = await Promise.all([
    createUnpooledAuthedUser(`marks-cand-${tag}`),
    createUnpooledAuthedUser(`marks-optout-${tag}`),
    createUnpooledAuthedUser(`marks-qa-${tag}`),
    createUnpooledAuthedUser(`marks-qaplus-${tag}`),
    createUnpooledAuthedUser(`marks-emp-${tag}`),
    createUnpooledAuthedUser(`marks-nosub-${tag}`),
  ]);
  userIds.push(cand.id, candOptOut.id, candQa.id, candQaPlus.id, employer.id, employerNoSub.id);
  await admin.from("profiles").update({ talent_directory_opt_in: true }).in("id", [cand.id, candQa.id, candQaPlus.id]);
  // The AUTH email stays on @talentrah.test (the global sweep keys on it); the PROFILE email is what is_qa_account reads. The names are ordinary, so only the plus-address clause can make this account a QA one.
  await admin.from("profiles").update({ email: `stonebridgehibr1+marks-${tag}@gmail.com`, first_name: "Plus", last_name: "Tester" }).eq("id", candQaPlus.id);
  await admin.from("profiles").update({ first_name: "QA", last_name: "Tester" }).eq("id", candQa.id);
  const { data: r } = await admin.from("resumes").insert({ user_id: cand.id, is_base: true, title: "Base", structured_content: { summary: "one", skills: ["a", "b"] } }).select("id").single();
  resumeId = r!.id;

  const { data: o1 } = await admin.from("organizations").insert({ name: `Marks Sub Org ${tag}`, created_by: employer.id, verified: true }).select("id").single();
  const { data: o2 } = await admin.from("organizations").insert({ name: `Marks NoSub Org ${tag}`, created_by: employerNoSub.id, verified: true }).select("id").single();
  orgIds.push(o1!.id, o2!.id);
  await admin.from("organization_members").insert([{ organization_id: o1!.id, user_id: employer.id, role: "owner" }, { organization_id: o2!.id, user_id: employerNoSub.id, role: "owner" }]);
  const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
  await admin.from("talent_directory_subscriptions").insert({ organization_id: o1!.id, plan_id: plan!.id, status: "active", expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() });
  const { data: job } = await admin.from("job_postings").insert({ organization_id: o1!.id, source_type: "internal", status: "open", title: `Marks job ${tag}`, company_name: "Marks Co", description: "d", dedup_fingerprint: `marks-${tag}` }).select("id").single();
  jobId = job!.id;
  const { data: apps } = await admin.from("applications").insert([cand, candOptOut, candQa, candQaPlus].map((c) => ({ user_id: c.id, job_posting_id: jobId, applied_at: new Date().toISOString() }))).select("id, user_id");
  for (const a of apps ?? []) appOf[a.user_id as string] = a.id as string;

  // review the candidates through the real function
  for (const c of [cand, candOptOut, candQa, candQaPlus]) {
    expect(await resolve(await pending(c.id), c.id, true)).toBe(true);
  }
}, 180_000);

afterAll(async () => {
  await deleteOrgsCascade(typedAdmin, orgIds);
  await deleteTestUsers(userIds);
  // Deleting a user removes its marks (cascade). Proven here on every run: nothing of this file's may remain.
  const { data: left, error: leftError } = await admin.from("verification_marks").select("id").in("user_id", userIds);
  if (leftError) throw new Error(`could not check for leftover marks: ${leftError.message}`);
  if ((left ?? []).length > 0) throw new Error(`${left!.length} mark(s) survived deleting their users`);
  const { data: leftProfiles, error: profError } = await admin.from("profiles").select("id").in("id", userIds);
  if (profError) throw new Error(`could not check for leftover profiles: ${profError.message}`);
  if ((leftProfiles ?? []).length > 0) throw new Error(`${leftProfiles!.length} test profile(s) survived deletion`);
}, 90_000);

describe("parity: a passed review awards exactly one mark that matches what the profile shows", () => {
  it("one resume_reviewed mark, dated as the profile, typed as the attempt, with a hash and the source row", async () => {
    const marks = await marksOf(cand.id);
    const { data: p } = await admin.from("profiles").select("talent_verification_status, talent_verified_at").eq("id", cand.id).single();
    const { data: tv } = await admin.from("talent_verifications").select("id, review_type").eq("user_id", cand.id).eq("status", "verified").single();
    expect(marks).toHaveLength(1);
    expect(p!.talent_verification_status).toBe("verified");
    expect(new Date(marks[0].earned_at).getTime()).toBe(new Date(p!.talent_verified_at as string).getTime());
    expect(marks[0].review_type).toBe(tv!.review_type);
    expect(marks[0].source_id).toBe(tv!.id);
    expect(marks[0].resume_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(marks[0].expires_at).getUTCFullYear() - new Date(marks[0].earned_at).getUTCFullYear()).toBeGreaterThanOrEqual(1);
  });
  it("resolving the same review twice returns false and writes no second mark", async () => {
    const { data: tv } = await admin.from("talent_verifications").select("id").eq("user_id", cand.id).eq("status", "verified").single();
    expect(await resolve(tv!.id, cand.id, true)).toBe(false);
    expect(await marksOf(cand.id)).toHaveLength(1);
  });
  it("a failed review writes no mark", async () => {
    const before = (await marksOf(candOptOut.id)).length;
    expect(await resolve(await pending(candOptOut.id), candOptOut.id, false)).toBe(true);
    expect((await marksOf(candOptOut.id)).length).toBe(before);
    // restore the verified state for the later gates
    await admin.from("profiles").update({ talent_verification_status: "verified", talent_verified_at: new Date().toISOString() }).eq("id", candOptOut.id);
  });
});

describe("no score, and the grants", () => {
  it("nothing the table holds is score-like", async () => {
    const { data, error } = await admin.from("verification_marks").select("*").limit(1);
    expect(error, error?.message).toBeNull();
    for (const key of Object.keys((data ?? [])[0] ?? {})) expect(key).not.toMatch(/(score|percent|pct|rating|points|grade)/i);
    const { error: scoreErr } = await admin.from("verification_marks").select("score").limit(1);
    expect(scoreErr, "a score column exists").not.toBeNull();
  });
  it("anon reads nothing", async () => {
    const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anon.from("verification_marks").select("id").limit(1);
    expect(error, "anon can read verification_marks").not.toBeNull();
  });
  it("a signed-in user reads only their own rows and only the listed columns", async () => {
    const { data, error } = await as(cand).from("verification_marks").select("id, user_id, mark_type, field, level, review_type, earned_at, expires_at");
    expect(error, error?.message).toBeNull();
    expect(data!.length).toBe(1);
    expect(data!.every((r) => r.user_id === cand.id)).toBe(true);
    for (const col of ["resume_hash", "source_id", "detail", "created_at"]) {
      const { error: e } = await as(cand).from("verification_marks").select(col).limit(1);
      expect(e, `authenticated can read ${col}`).not.toBeNull();
    }
    expect((await as(cand).from("verification_marks").select("*")).error, "select * must be refused").not.toBeNull();
  });
  it("nobody but the server writes: insert, update and delete are refused for a signed-in user, and the writer functions are not callable by them", async () => {
    const c = as(cand);
    const now = new Date().toISOString();
    expect((await c.from("verification_marks").insert({ user_id: cand.id, mark_type: "resume_reviewed", earned_at: now, expires_at: now })).error).not.toBeNull();
    expect((await c.from("verification_marks").update({ level: "strong" }).eq("user_id", cand.id)).error).not.toBeNull();
    expect((await c.from("verification_marks").delete().eq("user_id", cand.id)).error).not.toBeNull();
    expect((await c.rpc("award_verification_mark", { p_user_id: cand.id, p_mark_type: "resume_reviewed", p_field: null, p_level: null, p_review_type: "ai", p_source_id: null, p_resume_hash: null, p_earned_at: now })).error).not.toBeNull();
    expect((await c.rpc("resume_content_hash", { p_user_id: cand.id })).error).not.toBeNull();
  });
});

describe("the directory read (employer_visible_marks)", () => {
  it("returns the listed candidate's mark with exactly the contract's columns, and nothing for the QA account or the candidate who is not opted in", async () => {
    const r = await directory(employer, [cand.id, candOptOut.id, candQa.id]);
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.candidate_id)).toEqual([cand.id]);
    expect(Object.keys(r.rows[0]).sort()).toEqual(CONTRACT_KEYS);
    expect(r.rows[0].mark_type).toBe("resume_reviewed");
    expect(r.rows[0].level).toBeNull();
  });
  it("gives nothing to an employer whose organisation has no subscription, and refuses more than 100 ids", async () => {
    expect((await directory(employerNoSub, [cand.id])).rows).toEqual([]);
    const many = Array.from({ length: 101 }, () => randomUUID());
    expect((await directory(employer, many)).error).not.toBeNull();
  });
  it("does not return anything to anon", async () => {
    const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    expect((await anon.rpc("employer_visible_marks", { p_candidate_ids: [cand.id] })).error).not.toBeNull();
  });
});

describe("the applicants read (applicant_visible_marks)", () => {
  it("returns marks for applicants of the member's own job, regardless of the directory opt-in, but not for the QA account", async () => {
    const r = await applicants(employer);
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.application_id).sort()).toEqual(appIdsOf(cand, candOptOut));
    for (const row of r.rows) {
      expect(Object.keys(row).sort()).toEqual(APPLICANT_KEYS);
      expect(JSON.stringify(row)).not.toContain(cand.id); // no user id anywhere in the output
      expect(JSON.stringify(row)).not.toContain(candOptOut.id);
    }
  });
  it("returns nothing to a member of another organisation", async () => {
    expect((await applicants(employerNoSub)).rows).toEqual([]);
  });
  it("hides a resume_reviewed mark once the profile is no longer verified, and a deletion-requested applicant", async () => {
    await admin.from("profiles").update({ talent_verification_status: "rejected", talent_verified_at: null }).eq("id", candOptOut.id);
    expect((await applicants(employer)).rows.map((x) => x.application_id)).toEqual(appIdsOf(cand));
    await admin.from("profiles").update({ talent_verification_status: "verified", talent_verified_at: new Date().toISOString() }).eq("id", candOptOut.id);
    await admin.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", candOptOut.id);
    expect((await applicants(employer)).rows.map((x) => x.application_id)).toEqual(appIdsOf(cand));
    await admin.from("profiles").update({ deletion_requested_at: null }).eq("id", candOptOut.id);
  });
});

describe("QA by the owner's plus-address (0251): excluded from both reads, with a normal candidate as the positive control", () => {
  it("the fixture is sound: the plus-address candidate is verified, opted in, has an application and holds a live mark, and is_qa_account is the only thing that can hide it", async () => {
    const { data: p } = await admin.from("profiles").select("email, first_name, last_name, talent_verification_status, talent_directory_opt_in").eq("id", candQaPlus.id).single();
    expect(p!.email).toBe(`stonebridgehibr1+marks-${tag}@gmail.com`);
    expect(`${p!.first_name} ${p!.last_name}`).toBe("Plus Tester");
    expect(p!.talent_verification_status).toBe("verified");
    expect(p!.talent_directory_opt_in).toBe(true);
    expect(await marksOf(candQaPlus.id)).toHaveLength(1);
    expect(appOf[candQaPlus.id]).toBeTruthy();
    const { data: isQa } = await admin.rpc("is_qa_account", { p_email: p!.email, p_first: p!.first_name, p_last: p!.last_name, p_display: null });
    expect(isQa).toBe(true);
  });
  it("employer_visible_marks returns the normal candidate's mark and nothing for the plus-address account", async () => {
    const r = await directory(employer, [cand.id, candQaPlus.id]);
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.candidate_id), "the positive control is missing, or the QA account leaked").toEqual([cand.id]);
  });
  it("applicant_visible_marks returns the normal applicant's mark and nothing for the plus-address account", async () => {
    const r = await applicants(employer);
    expect(r.error).toBeNull();
    const ids = r.rows.map((x) => x.application_id);
    expect(ids, "the positive control is missing").toContain(appOf[cand.id]);
    expect(ids, "the plus-address QA account leaked into the applicants read").not.toContain(appOf[candQaPlus.id]);
  });
});

describe("expiry: twelve months, with an injected clock", () => {
  it("is live up to the expiry instant (exclusive): live at -1 s, not live at 0 and at +1 s", async () => {
    const [m] = await marksOf(cand.id);
    const at = (ms: number) => new Date(new Date(m.expires_at).getTime() + ms).toISOString();
    // The database keeps microseconds ("...14.148415+00:00") and a JS Date keeps milliseconds, so at(0) would be up to 999 microseconds BEFORE the real expiry and read as live. The instant itself is therefore passed back unchanged.
    const live = async (ms: number) => (await admin.rpc("verification_mark_is_live", { p_expires_at: m.expires_at, p_now: ms === 0 ? m.expires_at : at(ms) })).data as unknown as boolean;
    expect(await live(-1000)).toBe(true);
    expect(await live(0)).toBe(false);
    expect(await live(1000)).toBe(false);
  });
  it("a mark that expired an hour ago is not returned; one expiring in an hour is", async () => {
    const edge = async (offsetMs: number) => {
      const earned = new Date(Date.now() + offsetMs);
      earned.setUTCFullYear(earned.getUTCFullYear() - 1);
      // A skills_check mark in its own field, not a second resume_reviewed one: the applicants read returns only the NEWEST mark per (application, type, field), and candOptOut already holds a resume_reviewed mark dated today (from
      // beforeAll) that would hide an older injected one. The table cannot be cleaned up from here (service_role holds only SELECT and INSERT on it, by design), so the test does not try; a failed delete used to be ignored.
      const { error } = await admin.rpc("award_verification_mark", { p_user_id: candOptOut.id, p_mark_type: "skills_check", p_field: `expiry-edge-${offsetMs}`, p_level: "passed", p_review_type: null, p_source_id: null, p_resume_hash: null, p_earned_at: earned.toISOString() });
      expect(error, error?.message).toBeNull();
      await admin.from("profiles").update({ talent_directory_opt_in: true }).eq("id", candOptOut.id);
      const rows = (await applicants(employer)).rows.filter((x) => x.application_id === appOf[candOptOut.id]);
      return rows.some((x) => x.mark_type === "skills_check" && new Date(x.earned_at).getTime() === earned.getTime());
    };
    expect(await edge(3_600_000)).toBe(true);
    expect(await edge(-3_600_000)).toBe(false);
  });
  it("the table itself refuses an expires_at that is not earned_at + 12 months", async () => {
    const now = new Date().toISOString();
    const { error } = await admin.from("verification_marks").insert({ user_id: cand.id, mark_type: "resume_reviewed", earned_at: now, expires_at: new Date(Date.now() + 365 * 24 * 3600_000 + 86_400_000).toISOString() });
    expect(error, "an expires_at that is not earned_at + 12 months was accepted").not.toBeNull();
  });
});

describe("changed since review", () => {
  const flag = async () => (await directory(employer, [cand.id])).rows[0]?.changed_since_review;
  it("is false after the review and after a title-only save", async () => {
    expect(await flag()).toBe(false);
    await admin.from("resumes").update({ title: "Base renamed" }).eq("id", resumeId);
    expect(await flag()).toBe(false);
  });
  it("is false when only the key order changes, true after a real content edit, and false again after a re-review", async () => {
    await admin.from("resumes").update({ structured_content: { skills: ["a", "b"], summary: "one" } }).eq("id", resumeId);
    expect(await flag()).toBe(false);
    await admin.from("resumes").update({ structured_content: { skills: ["a", "b", "c"], summary: "one" } }).eq("id", resumeId);
    expect(await flag()).toBe(true);
    expect(await resolve(await pending(cand.id), cand.id, true)).toBe(true);
    expect(await flag()).toBe(false);
    expect((await marksOf(cand.id)).length).toBe(2); // history kept; the directory returns only the newest live one
    expect((await directory(employer, [cand.id])).rows).toHaveLength(1);
  });
});
