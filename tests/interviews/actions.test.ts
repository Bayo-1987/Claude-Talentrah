/**
 * The interview Server Actions on a real database with real sessions: the employer's gate (verified organisation, own applicant), the overlap WARNING (shown, never a block), the candidate's booking through
 * their own session, and "none of these work". The mail provider is a recorder. ONE employer identity for the whole file (requireUser's cache); the candidate actions read the session directly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const sessionRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sessionRef.current }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string }> }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({ emails: { send: async (p: { to: string; subject: string }) => { mail.sent.push(p); return { data: { id: "x" }, error: null }; } } }),
}));

const actions = await import("@/lib/interviews/actions");

let employer: TestUser;
let stranger: TestUser;
let candA: TestUser;
let candB: TestUser;
let employerSession: DB;
let candASession: DB;
let candBSession: DB;
let orgId: string;
let otherOrgId: string;
let job1: string;
let job2: string;
let foreignJob: string;
let appA1: string;
let appB2: string;
let foreignApp: string;
const orgIds: string[] = [];

const at = (n: number, hour = 9, minute = 0) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

async function job(organizationId: string, title: string) {
  const { data, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: organizationId, company_name: "EMPLOYER-TEST Co", title, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() }).select("id").single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}
async function apply(user: TestUser, jobId: string) {
  const { data, error } = await admin.from("applications").insert({ user_id: user.id, job_posting_id: jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
  if (error || !data) throw new Error(`application: ${error?.message}`);
  return data.id;
}
const offerInput = (over: Record<string, unknown> = {}) => ({ jobId: job1, applicationId: appA1, kind: "video", note: "", times: [at(5), at(6)], durationMinutes: 45, ...over });

beforeAll(async () => {
  [employer, stranger, candA, candB] = await Promise.all(["ivact-emp", "ivact-other", "ivact-a", "ivact-b"].map((p) => createTestUser(p)));
  [employerSession, candASession, candBSession] = await Promise.all([sessionFor(employer.email, employer.id), sessionFor(candA.email, candA.id), sessionFor(candB.email, candB.id)]);
  await admin.from("profiles").update({ first_name: "Joy", last_name: "Akindele" }).eq("id", candA.id);
  for (const [label, owner] of [["own", employer], ["other", stranger]] as const) {
    const { data: org, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg ivact ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true }).select("id").single();
    if (error || !org) throw new Error(`org: ${error?.message}`);
    orgIds.push(org.id);
    await admin.from("organization_members").insert({ organization_id: org.id, user_id: owner.id, role: "owner" });
    if (label === "own") orgId = org.id;
    else otherOrgId = org.id;
  }
  job1 = await job(orgId, "Growth Marketer");
  job2 = await job(orgId, "Designer");
  foreignJob = await job(otherOrgId, "Other role");
  appA1 = await apply(candA, job1);
  appB2 = await apply(candB, job2);
  foreignApp = await apply(candA, foreignJob);
}, 120_000);

beforeEach(async () => {
  sessionRef.current = employerSession;
  mail.sent.length = 0;
  await admin.from("organizations").update({ verified: true }).eq("id", orgId);
  await admin.from("interview_offers").delete().in("organization_id", [orgId, otherOrgId]);
  await admin.from("applicant_messages").delete().in("organization_id", [orgId, otherOrgId]);
  await admin.from("employer_applicant_status").delete().in("application_id", [appA1, appB2, foreignApp]);
  await admin.from("user_notifications").delete().eq("type", "interview_none_work").eq("user_id", employer.id);
});

afterAll(async () => {
  await admin.from("applications").delete().in("id", [appA1, appB2, foreignApp].filter(Boolean));
  await deleteOrgsCascade(admin, orgIds);
  await deleteTestUsers([employer, stranger, candA, candB].map((u) => u?.id).filter(Boolean) as string[]);
});

describe("createInterviewOfferAction: the employer's gate", () => {
  it("offers times for an applicant of the organisation's own job", async () => {
    const result = await actions.createInterviewOfferAction(offerInput());
    expect(result).toMatchObject({ ok: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(candA.email);
  });

  it("an UNVERIFIED company cannot invite: told to verify first, nothing created, nothing sent", async () => {
    await admin.from("organizations").update({ verified: false }).eq("id", orgId);
    const result = await actions.createInterviewOfferAction(offerInput());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/Verify your company first/);
    expect(mail.sent).toHaveLength(0);
    const { count } = await admin.from("interview_offers").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    expect(count ?? 0).toBe(0);
  });

  it("another organisation's applicant, an application that is not on the named job, and junk ids are refused", async () => {
    expect(await actions.createInterviewOfferAction(offerInput({ jobId: foreignJob, applicationId: foreignApp }))).toMatchObject({ ok: false });
    expect(await actions.createInterviewOfferAction(offerInput({ applicationId: appB2 }))).toMatchObject({ ok: false });
    expect(await actions.createInterviewOfferAction(offerInput({ applicationId: "x" }))).toMatchObject({ ok: false });
    expect(mail.sent).toHaveLength(0);
  });

  it("an applicant marked 'not a fit' cannot be invited", async () => {
    await admin.from("employer_applicant_status").upsert({ application_id: appA1, status: "not_a_fit" });
    expect(await actions.createInterviewOfferAction(offerInput())).toMatchObject({ ok: false, reason: "application_closed" });
  });
});

describe("the overlap WARNING (shown, never a block)", () => {
  async function bookOnJob2(startsAt: string) {
    const offer = await actions.createInterviewOfferAction({ ...offerInput({ jobId: job2, applicationId: appB2 }), times: [startsAt, at(9)] });
    expect(offer).toMatchObject({ ok: true });
    const { data: slot } = await admin.from("interview_slots").select("id").eq("offer_id", (offer as { offerId: string }).offerId).eq("starts_at", startsAt).single();
    sessionRef.current = candBSession;
    expect(await actions.bookInterviewSlotAction({ slotId: slot!.id, timeZone: "Africa/Lagos" })).toMatchObject({ ok: true });
    sessionRef.current = employerSession;
  }

  it("warns when a time offered for one job overlaps a BOOKED interview of another job of the same organisation, naming that job", async () => {
    await bookOnJob2(at(5, 9, 0));
    const warnings = await actions.interviewOverlapWarningsAction({ jobId: job1, applicationId: appA1, times: [at(5, 9, 30), at(7, 9)], durationMinutes: 45 });
    expect(warnings).toEqual([{ slotIndex: 0, jobTitle: "Designer" }]);
  });

  it("does not warn for a time that does not overlap, and never blocks: offering the overlapping time still works", async () => {
    await bookOnJob2(at(5, 9, 0));
    expect(await actions.interviewOverlapWarningsAction({ jobId: job1, applicationId: appA1, times: [at(5, 11, 0), at(7, 9)], durationMinutes: 45 })).toEqual([]);
    const offer = await actions.createInterviewOfferAction(offerInput({ times: [at(5, 9, 30), at(7, 9)] }));
    expect(offer).toMatchObject({ ok: true });
  });

  it("answers no warnings (and leaks nothing) for an applicant that is not the caller's organisation's", async () => {
    await bookOnJob2(at(5, 9, 0));
    expect(await actions.interviewOverlapWarningsAction({ jobId: foreignJob, applicationId: foreignApp, times: [at(5, 9, 30), at(7, 9)], durationMinutes: 45 })).toEqual([]);
  });
});

describe("the candidate's actions", () => {
  async function offer() {
    const result = await actions.createInterviewOfferAction(offerInput());
    return (result as { offerId: string }).offerId;
  }

  it("books through their own session; someone else's session cannot book their slot", async () => {
    const offerId = await offer();
    const { data: slots } = await admin.from("interview_slots").select("id").eq("offer_id", offerId).order("starts_at");
    sessionRef.current = candBSession;
    expect(await actions.bookInterviewSlotAction({ slotId: slots![0].id, timeZone: "Africa/Lagos" })).toMatchObject({ ok: false, reason: "not_found" });
    sessionRef.current = candASession;
    expect(await actions.bookInterviewSlotAction({ slotId: slots![0].id, timeZone: "Europe/London" })).toMatchObject({ ok: true });
    expect(await actions.bookInterviewSlotAction({ slotId: slots![1].id, timeZone: "Europe/London" })).toMatchObject({ ok: false, reason: "already_booked" });
  });

  it("rejects an id that is not an id before asking the database, and a signed-out caller", async () => {
    sessionRef.current = candASession;
    expect(await actions.bookInterviewSlotAction({ slotId: "not-a-uuid", timeZone: "UTC" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await actions.noneOfTheseTimesWorkAction({ offerId: "nope" })).toMatchObject({ ok: false });
  });

  it("'None of these work' reaches the employer once and leaves the offer open", async () => {
    const offerId = await offer();
    mail.sent.length = 0;
    sessionRef.current = candASession;
    expect(await actions.noneOfTheseTimesWorkAction({ offerId })).toEqual({ ok: true });
    expect(await actions.noneOfTheseTimesWorkAction({ offerId })).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(employer.email);
    const { data } = await admin.from("interview_offers").select("status").eq("id", offerId).single();
    expect(data?.status).toBe("open");
  });
});

describe("resendInterviewInvitationAction", () => {
  it("sends the open offer's invitation again and counts one more unit", async () => {
    await actions.createInterviewOfferAction(offerInput());
    mail.sent.length = 0;
    expect(await actions.resendInterviewInvitationAction({ jobId: job1, applicationId: appA1 })).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(1);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "failed");
    expect(count).toBe(2);
  });

  it("with no open offer there is nothing to send", async () => {
    expect(await actions.resendInterviewInvitationAction({ jobId: job1, applicationId: appA1 })).toMatchObject({ ok: false });
    expect(mail.sent).toHaveLength(0);
  });
});
