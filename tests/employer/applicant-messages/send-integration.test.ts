/**
 * Message candidate on a REAL database (0256): the authorization question the Server Action asks, and the real dependencies of the send (who the candidate is, the claim,
 * the sent/failed marks, the day's count). Only the mail provider is replaced, by a recorder, so the test can see exactly what would have been sent and to whom.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, createTestUser, deleteTestUsers, type TestUser } from "../../support/auth";
import { deleteOrgsCascade } from "../../support/delete-orgs";
import { isApplicantOfMyJob } from "@/lib/employer/applicant-messages/authorize";
import { sendApplicantMessage, type SendInput } from "@/lib/employer/applicant-messages/send";
import { defaultSendDeps } from "@/lib/employer/applicant-messages/send-deps";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;

let seeker: TestUser;
let saver: TestUser;
let ownerA: Authed;
let ownerB: Authed;
let orgA: string;
let orgB: string;
let jobA: string;
let jobB: string;
let appA: string;
let appB: string;
let bookmarkA: string;
const orgIds: string[] = [];

async function makeOrgWithJob(owner: Authed, label: string) {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ name: `EMPLOYER-TEST Msg ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true })
    .select("id")
    .single();
  if (error || !org) throw new Error(`org ${label}: ${error?.message}`);
  orgIds.push(org.id);
  const member = await admin.from("organization_members").insert({ organization_id: org.id, user_id: owner.id, role: "owner" });
  if (member.error) throw new Error(`member ${label}: ${member.error.message}`);
  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: org.id,
      company_name: `EMPLOYER-TEST Co ${label}`,
      title: `Growth Marketer ${label}`,
      description: "Fixture posting for the applicant message suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`job ${label}: ${jobError?.message}`);
  return { orgId: org.id, jobId: job.id };
}

async function apply(userId: string, jobId: string, applied: boolean): Promise<string> {
  const { data, error } = await admin
    .from("applications")
    .insert({ user_id: userId, job_posting_id: jobId, stage: applied ? "applied" : "saved", source: "internal_apply", applied_at: applied ? new Date().toISOString() : null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`application: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  [seeker, saver] = await Promise.all([createTestUser("amsg-seeker"), createTestUser("amsg-saver")]);
  [ownerA, ownerB] = await Promise.all([createAuthedTestUser("amsg-int-a"), createAuthedTestUser("amsg-int-b")]);
  await admin.from("profiles").update({ first_name: "Joy" }).eq("id", seeker.id);
  const a = await makeOrgWithJob(ownerA, "A");
  const b = await makeOrgWithJob(ownerB, "B");
  [orgA, jobA, orgB, jobB] = [a.orgId, a.jobId, b.orgId, b.jobId];
  appA = await apply(seeker.id, jobA, true);
  appB = await apply(seeker.id, jobB, true);
  bookmarkA = await apply(saver.id, jobA, false);
}, 90_000);

afterAll(async () => {
  await admin.from("applications").delete().in("id", [appA, appB, bookmarkA].filter(Boolean));
  if (orgIds.length) await deleteOrgsCascade(admin, orgIds);
  await deleteTestUsers([seeker?.id, saver?.id, ownerA?.id, ownerB?.id].filter(Boolean) as string[]);
});

describe("isApplicantOfMyJob: the employer's own session decides", () => {
  it("is true for an applicant on the organisation's own job", async () => {
    expect(await isApplicantOfMyJob(ownerA.client, { organizationId: orgA, jobId: jobA, applicationId: appA })).toBe(true);
  });

  it("is false for another organisation's job, even with that organisation's id claimed", async () => {
    expect(await isApplicantOfMyJob(ownerA.client, { organizationId: orgB, jobId: jobB, applicationId: appB })).toBe(false);
    expect(await isApplicantOfMyJob(ownerB.client, { organizationId: orgA, jobId: jobA, applicationId: appA })).toBe(false);
  });

  it("is false for an application that belongs to a different job (the URL's job and the application must agree)", async () => {
    expect(await isApplicantOfMyJob(ownerA.client, { organizationId: orgA, jobId: jobA, applicationId: appB })).toBe(false);
  });

  it("is false for a bookmark (saved, never applied) and for an id that does not exist", async () => {
    expect(await isApplicantOfMyJob(ownerA.client, { organizationId: orgA, jobId: jobA, applicationId: bookmarkA })).toBe(false);
    expect(await isApplicantOfMyJob(ownerA.client, { organizationId: orgA, jobId: jobA, applicationId: randomUUID() })).toBe(false);
  });
});

describe("sendApplicantMessage with the real dependencies and a recording mail provider", () => {
  const base = (): SendInput => ({
    organizationId: orgA,
    jobId: jobA,
    applicationId: appA,
    senderUserId: ownerA.id,
    senderEmail: "hiring@zimcrest.example",
    kind: "invite_interview",
    subject: "Interview for Growth Marketer",
    body: "Hi Joy,\n\nCould we talk this week?",
  });

  async function resetLog() {
    await admin.from("applicant_messages").delete().eq("organization_id", orgA);
    await admin.from("user_notifications").delete().eq("user_id", seeker.id).eq("type", "employer_message");
  }

  it("delivers once to the candidate, logs it as sent with no address in the log, notes it for the candidate, and reports 19 left", async () => {
    await resetLog();
    const delivered: Array<Record<string, string>> = [];
    const deps = { ...defaultSendDeps(), deliver: vi.fn(async (p: Record<string, string>) => { delivered.push(p); return true; }) };
    const result = await sendApplicantMessage(base(), deps as never);
    expect(result).toEqual({ ok: true, remaining: 19 });
    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe(seeker.email);
    expect(delivered[0].replyTo).toBe("hiring@zimcrest.example");
    expect(JSON.stringify(result)).not.toContain(seeker.email);

    const { data: rows } = await admin.from("applicant_messages").select("*").eq("organization_id", orgA);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ status: "sent", kind: "invite_interview", application_id: appA, job_posting_id: jobA, sender_user_id: ownerA.id });
    expect(rows![0].sent_at).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain(seeker.email);

    const { data: notes } = await admin.from("user_notifications").select("title, body").eq("user_id", seeker.id).eq("type", "employer_message");
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes)).not.toContain("Could we talk");
  });

  it("an application on another organisation's job, or a bookmark, is not_found: nothing delivered, no row, no slot used", async () => {
    await resetLog();
    const deliver = vi.fn(async () => true);
    const deps = { ...defaultSendDeps(), deliver };
    expect(await sendApplicantMessage({ ...base(), applicationId: appB }, deps as never)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await sendApplicantMessage({ ...base(), applicationId: bookmarkA }, deps as never)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await sendApplicantMessage({ ...base(), organizationId: orgB }, deps as never)).toMatchObject({ ok: false, reason: "not_found" });
    expect(deliver).not.toHaveBeenCalled();
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).in("organization_id", [orgA, orgB]);
    expect(count ?? 0).toBe(0);
  });

  it("a failed delivery leaves a failed row and the slot is free again", async () => {
    await resetLog();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = { ...defaultSendDeps(), deliver: vi.fn(async () => false) };
    expect(await sendApplicantMessage(base(), deps as never)).toMatchObject({ ok: false, reason: "send_failed" });
    const { data: rows } = await admin.from("applicant_messages").select("status, failure_reason").eq("organization_id", orgA);
    expect(rows).toEqual([{ status: "failed", failure_reason: "delivery failed" }]);
    expect(await defaultSendDeps().countToday(orgA), "a failed message does not count").toBe(0);
    vi.restoreAllMocks();
  });

  it("marking failed only ever touches a CLAIMED row: a message already sent stays sent, and a second failed mark changes nothing", async () => {
    await resetLog();
    const deps = defaultSendDeps();
    const sentId = await deps.claim({ organizationId: orgA, applicationId: appA, jobId: jobA, senderUserId: ownerA.id, kind: "custom", subject: "s", body: "b" });
    await deps.markSent(sentId!);
    await deps.markFailed(sentId!, "late failure");
    const { data } = await admin.from("applicant_messages").select("status, failure_reason").eq("id", sentId!).single();
    expect(data).toEqual({ status: "sent", failure_reason: null });
  });

  it("a candidate scheduled for deletion is unavailable: nothing is sent and no slot is used", async () => {
    await resetLog();
    await admin.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", seeker.id);
    try {
      const deliver = vi.fn(async () => true);
      const result = await sendApplicantMessage(base(), { ...defaultSendDeps(), deliver } as never);
      expect(result).toMatchObject({ ok: false, reason: "unavailable" });
      expect(deliver).not.toHaveBeenCalled();
      expect(await defaultSendDeps().countToday(orgA)).toBe(0);
    } finally {
      await admin.from("profiles").update({ deletion_requested_at: null }).eq("id", seeker.id);
    }
  });

  it("the 21st send of the day is refused with a clear message and nothing is delivered for it", async () => {
    await resetLog();
    const deps = { ...defaultSendDeps(), deliver: vi.fn(async () => true) };
    for (let i = 0; i < 20; i += 1) expect((await sendApplicantMessage(base(), deps as never)).ok).toBe(true);
    const twentyFirst = await sendApplicantMessage(base(), deps as never);
    expect(twentyFirst).toMatchObject({ ok: false, reason: "limit" });
    expect(deps.deliver).toHaveBeenCalledTimes(20);
  }, 60_000);
});
