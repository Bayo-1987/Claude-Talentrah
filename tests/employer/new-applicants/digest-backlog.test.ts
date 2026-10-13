/**
 * The first daily digest after the code deploys must cope with a BACKLOG: rows the 0254 triggers recorded before any code existed (is_first true, no instant email ever sent, no digest sent), recorded hours ago.
 * Real database, real claim/release functions; only the mail provider is a recorder. Needs 0251 and 0254.
 *
 * It proves, for an organisation with TWO members (one on 'instant', one on 'digest'): the digest member gets ONE email listing everyone; the instant member gets ONE email that INCLUDES the first-applicant row whose
 * instant email never went out (alreadyAnnounced is false) and skips a row whose instant email DID go out; every row is claimed exactly once (a second run sends nothing); a send that fails for every recipient RELEASES the
 * rows; and a small batch limit never drops a row (the next run takes the rest).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "../../support/auth";
import { deleteOrgsCascade } from "../../support/delete-orgs";

const { runNewApplicantDigest } = await import("@/lib/employer/new-applicants/digest");
const { defaultDigestDeps } = await import("@/lib/employer/new-applicants/deps");

type Sent = { to: string; subject: string; text: string };
let instantMember: TestUser;
let digestMember: TestUser;
let joy: TestUser;
let tunde: TestUser;
let ada: TestUser;
let orgId = "";
let job1 = "";
let job2 = "";
const appByName = new Map<string, string>();
const sent: Sent[] = [];
let failFor = new Set<string>();

async function job(title: string) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: orgId, company_name: "EMPLOYER-TEST Co", title, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}

async function setNotice(user: TestUser, mode: "instant" | "digest" | "off") {
  const { error } = await admin.from("email_preferences").update({ new_applicant_notice: mode }).eq("user_id", user.id);
  if (error) throw new Error(`pref: ${error.message}`);
}

/** Three applications as the 0254 trigger records them (Joy and Ada are each their job's FIRST), then moved back in time: a backlog nobody has emailed about. */
async function seedBacklog() {
  await admin.from("applications").delete().in("user_id", [joy.id, tunde.id, ada.id]);
  appByName.clear();
  for (const [name, user, jobId, day] of [["Joy Akindele", joy, job1, 1], ["Tunde Bello", tunde, job1, 2], ["Ada Okoro", ada, job2, 3]] as const) {
    const { data, error } = await admin
      .from("applications")
      .insert({ user_id: user.id, job_posting_id: jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !data) throw new Error(`application: ${error?.message}`);
    appByName.set(name, data.id);
    const { error: back } = await admin.from("employer_applicant_notifications").update({ created_at: `2001-01-0${day}T08:00:00Z`, instant_sent_at: null, digested_at: null }).eq("application_id", data.id);
    if (back) throw new Error(`backdate: ${back.message}`);
  }
}

async function notificationRows() {
  const { data, error } = await admin.from("employer_applicant_notifications").select("application_id, is_first, instant_sent_at, digested_at").eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The real digest dependencies, with the mail provider replaced by a recorder and, optionally, a batch limit small enough to see. */
function deps(limit?: number) {
  const real = defaultDigestDeps();
  return {
    ...real,
    ...(limit
      ? {
          async claim(until: Date) {
            const { data, error } = await admin.rpc("claim_applicant_digest", { p_until: until.toISOString(), p_limit: limit });
            if (error) throw new Error(error.message);
            return (data ?? []).map((r) => ({ notificationId: r.notification_id, applicationId: r.application_id, jobId: r.job_posting_id, organizationId: r.organization_id, isFirst: r.is_first, alreadyAnnounced: r.already_announced }));
          },
        }
      : {}),
    async send(p: Sent & { html: string }) {
      sent.push({ to: p.to, subject: p.subject, text: p.text });
      return !failFor.has(p.to);
    },
  };
}

const mine = () => sent.filter((m) => m.to === instantMember.email || m.to === digestMember.email);
const toInstant = () => sent.filter((m) => m.to === instantMember.email);
const toDigest = () => sent.filter((m) => m.to === digestMember.email);

beforeAll(async () => {
  [instantMember, digestMember, joy, tunde, ada] = await Promise.all(["nwb-instant", "nwb-digest", "nwb-joy", "nwb-tunde", "nwb-ada"].map((p) => createTestUser(p)));
  await admin.from("profiles").update({ first_name: "Joy", last_name: "Akindele" }).eq("id", joy.id);
  await admin.from("profiles").update({ first_name: "Tunde", last_name: "Bello" }).eq("id", tunde.id);
  await admin.from("profiles").update({ first_name: "Ada", last_name: "Okoro" }).eq("id", ada.id);
  const { data: org, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg backlog ${randomUUID().slice(0, 8)}`, created_by: instantMember.id, verified: true }).select("id").single();
  if (error || !org) throw new Error(`org: ${error?.message}`);
  orgId = org.id;
  for (const [u, role] of [[instantMember, "owner"], [digestMember, "admin"]] as const) {
    const m = await admin.from("organization_members").insert({ organization_id: orgId, user_id: u.id, role });
    if (m.error) throw new Error(`member: ${m.error.message}`);
  }
  // Pooled test users keep their preferences between files, so each member's setting is stated, never assumed.
  await setNotice(instantMember, "instant");
  await setNotice(digestMember, "digest");
  job1 = await job("Growth Marketer");
  job2 = await job("Designer");
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  failFor = new Set();
  await seedBacklog();
});

afterAll(async () => {
  await admin.from("applications").delete().in("user_id", [joy?.id, tunde?.id, ada?.id].filter(Boolean) as string[]);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([instantMember, digestMember, joy, tunde, ada].map((u) => u?.id).filter(Boolean) as string[]);
});

describe("the first digest after deploy, with a backlog nobody was emailed about", () => {
  it("the backlog is what the 0254 triggers record: two first-applicant rows with no instant email and no digest, hours old", async () => {
    const rows = await notificationRows();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.is_first).map((r) => r.application_id).sort()).toEqual([appByName.get("Joy Akindele")!, appByName.get("Ada Okoro")!].sort());
    expect(rows.every((r) => r.instant_sent_at === null && r.digested_at === null)).toBe(true);
  });

  it("the member on 'digest' gets ONE email listing all three applicants; the member on 'instant' gets ONE email that INCLUDES the first-applicant row whose instant email never went out", async () => {
    const summary = await runNewApplicantDigest(deps());
    expect(summary.claimed).toBeGreaterThanOrEqual(3);
    expect(toDigest()).toHaveLength(1);
    expect(toInstant()).toHaveLength(1);
    for (const email of [toDigest()[0], toInstant()[0]]) {
      expect(email.subject).toBe("3 new applicants on Talentrah");
      for (const name of ["Joy Akindele", "Tunde Bello", "Ada Okoro", "Growth Marketer", "Designer"]) expect(email.text, `${name} is listed`).toContain(name);
    }
    expect(mine()).toHaveLength(2);
  });

  it("a first-applicant row whose instant email DID go out is left out for the member on 'instant' and still listed for the member on 'digest'", async () => {
    await admin.from("employer_applicant_notifications").update({ instant_sent_at: new Date().toISOString() }).eq("application_id", appByName.get("Joy Akindele")!);
    await runNewApplicantDigest(deps());
    expect(toDigest()[0].text).toContain("Joy Akindele");
    expect(toInstant()).toHaveLength(1);
    expect(toInstant()[0].subject).toBe("2 new applicants on Talentrah");
    expect(toInstant()[0].text).not.toContain("Joy Akindele");
    expect(toInstant()[0].text).toContain("Tunde Bello");
    expect(toInstant()[0].text).toContain("Ada Okoro");
  });

  it("every row is claimed exactly once: a second run sends nothing to this organisation and leaves the claim times alone", async () => {
    await runNewApplicantDigest(deps());
    const claimed = await notificationRows();
    expect(claimed.every((r) => r.digested_at !== null)).toBe(true);
    sent.length = 0;
    await runNewApplicantDigest(deps());
    expect(mine()).toHaveLength(0);
    const again = await notificationRows();
    expect(again.map((r) => [r.application_id, r.digested_at]).sort()).toEqual(claimed.map((r) => [r.application_id, r.digested_at]).sort());
  });

  it("a send that fails for EVERY recipient releases the organisation's rows (the run reports not ok), and the next run delivers them", async () => {
    failFor = new Set([instantMember.email, digestMember.email]);
    const failed = await runNewApplicantDigest(deps());
    expect(failed.ok).toBe(false);
    expect(failed.released).toBeGreaterThanOrEqual(3);
    expect((await notificationRows()).every((r) => r.digested_at === null), "the rows are released").toBe(true);
    sent.length = 0;
    failFor = new Set();
    await runNewApplicantDigest(deps());
    expect(toDigest()).toHaveLength(1);
    expect(toDigest()[0].subject).toBe("3 new applicants on Talentrah");
    expect((await notificationRows()).every((r) => r.digested_at !== null)).toBe(true);
  });

  it("if ONE recipient got the email the rows are NOT released (nobody is told twice)", async () => {
    failFor = new Set([instantMember.email]);
    await runNewApplicantDigest(deps());
    expect((await notificationRows()).every((r) => r.digested_at !== null)).toBe(true);
    sent.length = 0;
    await runNewApplicantDigest(deps());
    expect(mine()).toHaveLength(0);
  });

  it("a batch limit never drops a row: with a limit of 2 the first run takes the two oldest, the next run takes the rest, and every applicant appears exactly once in the digest member's emails", async () => {
    await runNewApplicantDigest(deps(2));
    expect((await notificationRows()).filter((r) => r.digested_at !== null)).toHaveLength(2);
    await runNewApplicantDigest(deps(2));
    expect((await notificationRows()).filter((r) => r.digested_at !== null)).toHaveLength(3);
    const digestText = toDigest().map((m) => m.text).join("\n");
    for (const name of ["Joy Akindele", "Tunde Bello", "Ada Okoro"]) expect(digestText.split(name).length - 1, `${name} appears exactly once`).toBe(1);
    expect(toDigest()).toHaveLength(2);
  });
});
