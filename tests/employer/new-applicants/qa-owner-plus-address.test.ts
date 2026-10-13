/**
 * No email may go to or about a QA account, including the owner's own test accounts (0251: the whole email is stonebridgehibr1+<tag>@gmail.com). Real database. Needs 0251 and 0254.
 *
 * As APPLICANT: a plus-address applicant is recorded suppressed ('qa_applicant'), is never a job's first applicant (so an ordinary applicant after them still is), is claimed by no instant claim and by no digest claim,
 * and is never named in an email. As MEMBER: a plus-address member is not returned by new_applicant_recipients and receives neither an instant nor a digest email. CONTROL: the bare mailbox
 * stonebridgehibr1@gmail.com (the owner's real address) is NOT a QA account, so a member with it is a normal recipient.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "../../support/auth";
import { deleteOrgsCascade } from "../../support/delete-orgs";

const { runNewApplicantDigest } = await import("@/lib/employer/new-applicants/digest");
const { notifyFirstApplicant } = await import("@/lib/employer/new-applicants/instant");
const { defaultDigestDeps, defaultInstantDeps } = await import("@/lib/employer/new-applicants/deps");

type Sent = { to: string; subject: string; text: string };
const tag = randomUUID().slice(0, 8);
const plusApplicantEmail = `stonebridgehibr1+nwq-applicant-${tag}@gmail.com`;
const plusMemberEmail = `stonebridgehibr1+nwq-member-${tag}@gmail.com`;
const bareEmail = "stonebridgehibr1@gmail.com";
// The tags must NOT contain "+qa-": that is the older rule (0240) and would make these pass without 0251.
if ([plusApplicantEmail, plusMemberEmail].some((e) => e.includes("+qa-"))) throw new Error("fixture addresses must exercise the 0251 pattern, not the +qa- rule");

let ordinaryOwner: TestUser;
let plusMember: TestUser;
let bareMember: TestUser;
let plusApplicant: TestUser;
let ordinaryApplicant: TestUser;
let orgId = "";
let jobId = "";
let ordinaryApplication = "";
const original = new Map<string, string>();
const sent: Sent[] = [];

async function setEmail(user: TestUser, email: string) {
  original.set(user.id, user.email);
  const { error } = await admin.from("profiles").update({ email }).eq("id", user.id);
  if (error) throw new Error(`profile email: ${error.message}`);
}
async function setNotice(user: TestUser, mode: "instant" | "digest" | "off") {
  const { error } = await admin.from("email_preferences").update({ new_applicant_notice: mode }).eq("user_id", user.id);
  if (error) throw new Error(`pref: ${error.message}`);
}
async function apply(user: TestUser) {
  const { data, error } = await admin
    .from("applications")
    .insert({ user_id: user.id, job_posting_id: jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`application: ${error?.message}`);
  return data.id;
}
const row = async (applicationId: string) => (await admin.from("employer_applicant_notifications").select("is_first, suppressed_reason, instant_sent_at, digested_at").eq("application_id", applicationId).single()).data!;

const recorder = async (p: Sent & { html: string }) => {
  sent.push({ to: p.to, subject: p.subject, text: p.text });
  return true;
};
const forMyOrg = (list: Sent[]) => list.filter((m) => [ordinaryOwner.email, plusMemberEmail, bareEmail].includes(m.to));

beforeAll(async () => {
  [ordinaryOwner, plusMember, bareMember, plusApplicant, ordinaryApplicant] = await Promise.all(["nwq-owner", "nwq-plus-member", "nwq-bare-member", "nwq-plus-app", "nwq-ordinary-app"].map((p) => createTestUser(p)));
  await setEmail(plusMember, plusMemberEmail);
  await setEmail(bareMember, bareEmail);
  await setEmail(plusApplicant, plusApplicantEmail);
  await admin.from("profiles").update({ first_name: "Amara", last_name: "Test" }).eq("id", plusApplicant.id);
  await admin.from("profiles").update({ first_name: "Chidi", last_name: "Eze" }).eq("id", ordinaryApplicant.id);
  const { data: org, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg qa ${tag}`, created_by: ordinaryOwner.id, verified: true }).select("id").single();
  if (error || !org) throw new Error(`org: ${error?.message}`);
  orgId = org.id;
  for (const [u, role] of [[ordinaryOwner, "owner"], [plusMember, "admin"], [bareMember, "admin"]] as const) {
    const m = await admin.from("organization_members").insert({ organization_id: orgId, user_id: u.id, role });
    if (m.error) throw new Error(`member: ${m.error.message}`);
    await setNotice(u, "instant");
  }
  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: orgId, company_name: "EMPLOYER-TEST Co", title: "QA Rule Role", description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`job: ${jobError?.message}`);
  jobId = job.id;
}, 120_000);

afterAll(async () => {
  await admin.from("applications").delete().in("user_id", [plusApplicant?.id, ordinaryApplicant?.id].filter(Boolean) as string[]);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  // Pooled accounts are reused: give every changed profile its own address back before releasing it.
  for (const [id, email] of original) await admin.from("profiles").update({ email }).eq("id", id);
  await deleteTestUsers([ordinaryOwner, plusMember, bareMember, plusApplicant, ordinaryApplicant].map((u) => u?.id).filter(Boolean) as string[]);
});

describe("the owner's plus-address as an APPLICANT", () => {
  it("is recorded suppressed, never first, claimed by no instant claim and no digest claim, and never named in an email; the ordinary applicant after them is still the job's first", async () => {
    const qaApplication = await apply(plusApplicant);
    const qa = await row(qaApplication);
    expect(qa.suppressed_reason).toBe("qa_applicant");
    expect(qa.is_first).toBe(false);

    const claim = await admin.rpc("claim_applicant_instant", { p_application: qaApplication });
    expect(claim.data ?? []).toHaveLength(0);
    expect((await row(qaApplication)).instant_sent_at).toBeNull();

    ordinaryApplication = await apply(ordinaryApplicant);
    expect((await row(ordinaryApplication)).is_first, "a QA applicant never takes the first slot").toBe(true);

    sent.length = 0;
    const instant = await notifyFirstApplicant(ordinaryApplication, { ...defaultInstantDeps(), send: recorder });
    expect(instant.status).toBe("sent");
    const digestClaim = await admin.rpc("claim_applicant_digest", { p_until: new Date(Date.now() + 3_600_000).toISOString() });
    expect((digestClaim.data ?? []).map((r) => r.application_id), "no digest claim returns the QA row").not.toContain(qaApplication);
    expect((await row(qaApplication)).digested_at).toBeNull();
    expect(sent.some((m) => m.text.includes("Amara Test")), "the QA applicant is never named").toBe(false);
    // Put the claimed ordinary row back so the digest test below starts from a known state.
    await admin.rpc("release_applicant_digest", { p_ids: (digestClaim.data ?? []).map((r) => r.notification_id) });
  });
});

describe("the owner's plus-address as a MEMBER, and the bare mailbox as the control", () => {
  it("new_applicant_recipients returns the ordinary owner and the bare-mailbox member, never the plus-address member", async () => {
    const { data, error } = await admin.rpc("new_applicant_recipients", { p_organization: orgId });
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.user_id);
    expect(ids).toContain(ordinaryOwner.id);
    expect(ids, "the bare owner mailbox is the owner's real address, not a QA account").toContain(bareMember.id);
    expect(ids).not.toContain(plusMember.id);
  });

  it("the instant email and the digest both go to the ordinary owner and the bare-mailbox member and to nobody at the plus-address", async () => {
    const application = ordinaryApplication;
    expect(application, "the ordinary applicant's application from the first test").not.toBe("");
    await admin.from("employer_applicant_notifications").update({ instant_sent_at: null, digested_at: null, created_at: "2001-02-01T08:00:00Z" }).eq("application_id", application);
    sent.length = 0;
    await notifyFirstApplicant(application, { ...defaultInstantDeps(), send: recorder });
    await admin.from("employer_applicant_notifications").update({ digested_at: null, created_at: "2001-02-01T08:00:00Z" }).eq("application_id", application);
    await runNewApplicantDigest({ ...defaultDigestDeps(), send: recorder });

    const recipients = new Set(forMyOrg(sent).map((m) => m.to));
    expect(recipients.has(plusMemberEmail), "no email to the plus-address member").toBe(false);
    expect(recipients.has(ordinaryOwner.email) || recipients.has(bareEmail), "the ordinary members are still emailed").toBe(true);
    expect(recipients.has(bareEmail), "the bare mailbox is a normal recipient").toBe(true);
  });
});
