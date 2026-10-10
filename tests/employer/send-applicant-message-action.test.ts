/**
 * "Message candidate", the Server Action layer (src/lib/employer/applicant-message-actions.ts), on a real database with the employer's REAL session (tests/support/auth.ts's
 * sessionFor, so requireEmployer and employer_job_applicants run through the real policies). Only the mail provider is replaced, by a recorder. ONE employer identity for the
 * whole file (requireUser's cache degrades to a module-level memo outside a real request, same constraint as tests/employer/draft-job-action.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => testClientRef.current }));

const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>>, fail: false }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({
    emails: {
      send: async (payload: Record<string, unknown>) => {
        if (mail.fail) return { data: null, error: { message: "provider down" } };
        mail.sent.push(payload);
        return { data: { id: "test" }, error: null };
      },
    },
  }),
}));

const confirmation = vi.hoisted(() => ({ confirmed: true }));
vi.mock("@/lib/employer/membership", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/employer/membership")>();
  return { ...real, requireEmployer: async () => ({ ...(await real.requireEmployer()), emailConfirmed: confirmation.confirmed }) };
});

const { sendApplicantMessageAction } = await import("@/lib/employer/applicant-message-actions");

let employer: TestUser;
let seeker: TestUser;
let stranger: TestUser;
let orgId: string;
let otherOrgId: string;
let jobId: string;
let otherJobId: string;
let applicationId: string;
let foreignApplicationId: string;
const orgIds: string[] = [];

const base = () => ({ jobId, applicationId, kind: "invite_interview", subject: "Interview for Growth Marketer", body: "Hi Joy,\n\nCould we talk this week?" });

async function makeJob(organizationId: string, title: string): Promise<string> {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: organizationId,
      company_name: "EMPLOYER-TEST Co",
      title,
      description: "Fixture posting for the message action suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  [employer, seeker, stranger] = await Promise.all([createTestUser("amsg-act-emp"), createTestUser("amsg-act-seeker"), createTestUser("amsg-act-other")]);
  testClientRef.current = await sessionFor(employer.email, employer.id);
  await admin.from("profiles").update({ first_name: "Joy" }).eq("id", seeker.id);

  for (const [label, owner] of [["own", employer], ["other", stranger]] as const) {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `EMPLOYER-TEST Msg action ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true })
      .select("id")
      .single();
    if (error || !org) throw new Error(`org ${label}: ${error?.message}`);
    orgIds.push(org.id);
    const member = await admin.from("organization_members").insert({ organization_id: org.id, user_id: owner.id, role: "owner" });
    if (member.error) throw new Error(`member ${label}: ${member.error.message}`);
    if (label === "own") orgId = org.id;
    else otherOrgId = org.id;
  }
  jobId = await makeJob(orgId, "Growth Marketer");
  otherJobId = await makeJob(otherOrgId, "Other Role");
  const apply = async (job: string) => {
    const { data, error } = await admin
      .from("applications")
      .insert({ user_id: seeker.id, job_posting_id: job, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !data) throw new Error(`application: ${error?.message}`);
    return data.id;
  };
  applicationId = await apply(jobId);
  foreignApplicationId = await apply(otherJobId);
}, 90_000);

beforeEach(async () => {
  mail.sent.length = 0;
  mail.fail = false;
  confirmation.confirmed = true;
  await admin.from("applicant_messages").delete().in("organization_id", [orgId, otherOrgId]);
});

afterAll(async () => {
  await admin.from("applications").delete().in("id", [applicationId, foreignApplicationId].filter(Boolean));
  if (orgIds.length) await deleteOrgsCascade(admin, orgIds);
  await deleteTestUsers([employer?.id, seeker?.id, stranger?.id].filter(Boolean) as string[]);
});

describe("sendApplicantMessageAction", () => {
  it("sends through Talentrah to the candidate with Reply-To = the employer, logs it, and the result carries only the count left", async () => {
    const result = await sendApplicantMessageAction(base());
    expect(result).toEqual({ ok: true, remaining: 19 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(seeker.email);
    expect(mail.sent[0].replyTo).toBe(employer.email);
    expect(String(mail.sent[0].from)).toMatch(/via Talentrah <notifications@talentrah\.com>$/);
    expect(String(mail.sent[0].text)).toContain("Could we talk this week?");
    expect(JSON.stringify(result)).not.toContain(seeker.email);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "sent");
    expect(count).toBe(1);
  });

  it("an applicant on ANOTHER organisation's job is refused, even when the caller names that job and application", async () => {
    const viaOtherJob = await sendApplicantMessageAction({ ...base(), jobId: otherJobId, applicationId: foreignApplicationId });
    expect(viaOtherJob.ok).toBe(false);
    const wrongPair = await sendApplicantMessageAction({ ...base(), applicationId: foreignApplicationId });
    expect(wrongPair.ok, "the application is not on the job named in the request").toBe(false);
    expect(mail.sent).toHaveLength(0);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).in("organization_id", [orgId, otherOrgId]);
    expect(count ?? 0).toBe(0);
  });

  it("junk identifiers are refused without touching the database or the provider", async () => {
    expect((await sendApplicantMessageAction({ ...base(), applicationId: "not-a-uuid" })).ok).toBe(false);
    expect((await sendApplicantMessageAction({ ...base(), jobId: "' or 1=1 --" })).ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it("a browser cannot claim the interview-invite kind: an unknown or reserved kind is stored as 'custom'", async () => {
    await sendApplicantMessageAction({ ...base(), kind: "interview_invite" });
    await sendApplicantMessageAction({ ...base(), kind: "whatever" });
    const { data } = await admin.from("applicant_messages").select("kind").eq("organization_id", orgId);
    expect((data ?? []).map((r) => r.kind)).toEqual(["custom", "custom"]);
  });

  it("an employer whose email is not confirmed cannot send (the Reply-To would be unverified)", async () => {
    confirmation.confirmed = false;
    const result = await sendApplicantMessageAction(base());
    expect(result.ok).toBe(false);
    expect(mail.sent).toHaveLength(0);
  });

  it("when the provider is down the employer is told, nothing counts against the day, and the failure is visible in the log", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mail.fail = true;
    const result = await sendApplicantMessageAction(base());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/did not count/i);
    const { data } = await admin.from("applicant_messages").select("status").eq("organization_id", orgId);
    expect(data).toEqual([{ status: "failed" }]);
    vi.restoreAllMocks();
  });

  it("the 21st message of the day is refused with the limit message", async () => {
    for (let i = 0; i < 20; i += 1) expect((await sendApplicantMessageAction(base())).ok).toBe(true);
    const result = await sendApplicantMessageAction(base());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/limit of 20/);
    expect(mail.sent).toHaveLength(20);
  }, 60_000);
});
