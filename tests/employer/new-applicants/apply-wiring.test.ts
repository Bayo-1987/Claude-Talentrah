/**
 * New-applicant notifications (0254), end to end on a real database: a real Apply (applyInAppAction, with next's after() run inline) records the notification, the FIRST applicant of a job is emailed
 * at once to the members on 'instant' only, everyone after that waits for the daily digest, a QA applicant produces nothing, an 'off' member gets nothing, and re-applying never emails twice. Only
 * the mail provider is a recorder. Needs 0251 and 0254 on the database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB, type TestUser } from "../../support/auth";
import { deleteOrgsCascade } from "../../support/delete-orgs";

const pending = vi.hoisted(() => [] as Array<Promise<unknown>>);
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn).catch(() => {})) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const sessionRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sessionRef.current }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({ emails: { send: async (p: { to: string; subject: string; text: string }) => { mail.sent.push(p); return { data: { id: "x" }, error: null }; } } }),
}));

const { applyInAppAction } = await import("@/lib/applications/actions");
const { runNewApplicantDigest } = await import("@/lib/employer/new-applicants/digest");
const { defaultDigestDeps } = await import("@/lib/employer/new-applicants/deps");

let instantOwner: TestUser;
let digestMember: TestUser;
let offMember: TestUser;
let seekerA: TestUser;
let seekerB: TestUser;
let qaSeeker: TestUser;
const clients = new Map<string, DB>();
let orgId: string;
let jobId: string;
let otherJobId: string;
let externalJobId: string;

async function job(organizationId: string | null, title: string, source: "internal" | "external") {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: source,
      organization_id: organizationId,
      company_name: "EMPLOYER-TEST Co",
      title,
      description: "Fixture.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      ...(source === "external" ? { external_source: "nwa-test", external_url: `https://example.test/${randomUUID()}` } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}

async function apply(user: TestUser, forJob: string) {
  sessionRef.current = clients.get(user.id)!;
  await applyInAppAction(forJob, "none");
  await Promise.all(pending.splice(0));
}

async function setNotice(user: TestUser, mode: "instant" | "digest" | "off") {
  const { error } = await admin.from("email_preferences").update({ new_applicant_notice: mode }).eq("user_id", user.id);
  if (error) throw new Error(`pref: ${error.message}`);
}

beforeAll(async () => {
  [instantOwner, digestMember, offMember, seekerA, seekerB, qaSeeker] = await Promise.all(
    ["nwa-owner", "nwa-digest", "nwa-off", "nwa-seeker-a", "nwa-seeker-b", "nwa-qa"].map((p) => createTestUser(p)),
  );
  for (const u of [seekerA, seekerB, qaSeeker]) clients.set(u.id, await sessionFor(u.email, u.id));
  await admin.from("profiles").update({ first_name: "Joy", last_name: "Akindele" }).eq("id", seekerA.id);
  await admin.from("profiles").update({ first_name: "Tunde", last_name: "Bello" }).eq("id", seekerB.id);
  await admin.from("profiles").update({ first_name: "QA Bot", last_name: "Seeker" }).eq("id", qaSeeker.id);

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ name: `EMPLOYER-TEST Msg nwa ${randomUUID().slice(0, 8)}`, created_by: instantOwner.id, verified: true })
    .select("id")
    .single();
  if (error || !org) throw new Error(`org: ${error?.message}`);
  orgId = org.id;
  for (const [u, role] of [[instantOwner, "owner"], [digestMember, "admin"], [offMember, "admin"]] as const) {
    const m = await admin.from("organization_members").insert({ organization_id: orgId, user_id: u.id, role });
    if (m.error) throw new Error(`member: ${m.error.message}`);
  }
  // Pooled test users keep their preferences between files (reset_test_pool_user knows nothing of 0254's column), so every member's setting is stated, never assumed.
  await setNotice(instantOwner, "instant");
  await setNotice(digestMember, "digest");
  await setNotice(offMember, "off");
  jobId = await job(orgId, "Growth Marketer", "internal");
  otherJobId = await job(orgId, "Designer", "internal");
  externalJobId = await job(null, "External role", "external");
}, 120_000);

beforeEach(async () => {
  mail.sent.length = 0;
  await admin.from("employer_applicant_notifications").delete().eq("organization_id", orgId);
  await admin.from("applications").delete().in("user_id", [seekerA.id, seekerB.id, qaSeeker.id]);
});

afterAll(async () => {
  await admin.from("applications").delete().in("user_id", [seekerA.id, seekerB.id, qaSeeker.id]);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await admin.from("job_postings").delete().eq("id", externalJobId);
  await deleteTestUsers([instantOwner, digestMember, offMember, seekerA, seekerB, qaSeeker].map((u) => u?.id).filter(Boolean) as string[]);
});

describe("an Apply produces the instant email for the first applicant of a job, and only that", () => {
  it("the first applicant: ONE email, to the member on 'instant' only, with the name, the job and a link", async () => {
    await apply(seekerA, jobId);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(instantOwner.email);
    expect(mail.sent[0].subject).toBe("New applicant for Growth Marketer");
    expect(mail.sent[0].text).toContain("Joy Akindele applied for Growth Marketer.");
    expect(mail.sent[0].text).toContain(`/employer/jobs/${jobId}/applicants`);
    const recipients = mail.sent.map((m) => m.to);
    expect(recipients).not.toContain(digestMember.email);
    expect(recipients).not.toContain(offMember.email);
    for (const m of mail.sent) expect(m.text).not.toContain(seekerA.email);
  });

  it("the second applicant of the same job is not emailed at once; a first applicant of ANOTHER job is", async () => {
    await apply(seekerA, jobId);
    mail.sent.length = 0;
    await apply(seekerB, jobId);
    expect(mail.sent, "the second applicant waits for the digest").toHaveLength(0);
    await apply(seekerB, otherJobId);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("New applicant for Designer");
  });

  it("re-applying (a second Apply on the same job) never produces a second email", async () => {
    await apply(seekerA, jobId);
    await apply(seekerA, jobId);
    expect(mail.sent).toHaveLength(1);
    const { count } = await admin.from("employer_applicant_notifications").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    expect(count, "one notification per application").toBe(1);
  });

  it("a QA applicant produces no email and is never the 'first'; the next real applicant still is", async () => {
    await apply(qaSeeker, jobId);
    expect(mail.sent).toHaveLength(0);
    await apply(seekerA, jobId);
    expect(mail.sent).toHaveLength(1);
    const { data } = await admin.from("employer_applicant_notifications").select("suppressed_reason, is_first").eq("organization_id", orgId);
    expect(data).toEqual(expect.arrayContaining([{ suppressed_reason: "qa_applicant", is_first: false }, { suppressed_reason: null, is_first: true }]));
  });

  it("an external posting produces nothing", async () => {
    await apply(seekerA, externalJobId);
    expect(mail.sent).toHaveLength(0);
  });
});

describe("the daily digest", () => {
  it("carries everyone since the last run: 'digest' members hear about all applicants, 'instant' members only about those not already announced, 'off' about none; a second run sends nothing", async () => {
    await apply(seekerA, jobId);
    await apply(seekerB, jobId);
    await apply(qaSeeker, jobId);
    mail.sent.length = 0;

    const summary = await runNewApplicantDigest(defaultDigestDeps(), new Date(Date.now() + 5000));
    // The claim is global (every organisation's due rows), and other suites apply to jobs in parallel: assert on THIS organisation's mail, and only that at least our two were claimed.
    expect(summary.claimed).toBeGreaterThanOrEqual(2);
    const byRecipient = new Map(mail.sent.map((m) => [m.to, m]));
    expect(byRecipient.get(digestMember.email)?.subject).toBe("2 new applicants on Talentrah");
    expect(byRecipient.get(digestMember.email)?.text).toContain("Joy Akindele");
    expect(byRecipient.get(digestMember.email)?.text).toContain("Tunde Bello");
    expect(byRecipient.get(instantOwner.email)?.subject, "Joy was already announced instantly").toBe("1 new applicant on Talentrah");
    expect(byRecipient.get(instantOwner.email)?.text).toContain("Tunde Bello");
    expect(byRecipient.get(instantOwner.email)?.text).not.toContain("Joy Akindele");
    expect(byRecipient.has(offMember.email)).toBe(false);
    expect([...byRecipient.values()].map((m) => m.text).join("\n")).not.toContain("QA Bot");

    mail.sent.length = 0;
    await runNewApplicantDigest(defaultDigestDeps(), new Date(Date.now() + 5000));
    expect(mail.sent.filter((m) => [instantOwner.email, digestMember.email, offMember.email].includes(m.to)), "a second run tells this organisation nothing more").toHaveLength(0);
  });

  it("two overlapping digest runs send each applicant once between them", async () => {
    await apply(seekerA, jobId);
    await apply(seekerB, jobId);
    mail.sent.length = 0;
    const until = new Date(Date.now() + 5000);
    const [one, two] = await Promise.all([runNewApplicantDigest(defaultDigestDeps(), until), runNewApplicantDigest(defaultDigestDeps(), until)]);
    expect(one.claimed + two.claimed, "the database hands each notification to exactly one run: ours are among them").toBeGreaterThanOrEqual(2);
    const toDigestMember = mail.sent.filter((m) => m.to === digestMember.email);
    const names = toDigestMember.map((m) => m.text).join("\n");
    expect((names.match(/Joy Akindele/g) ?? []).length).toBe(1);
    expect((names.match(/Tunde Bello/g) ?? []).length).toBe(1);
  });
});
