/**
 * 0256 — the applicant message log and its shared daily limit.
 *
 * `claim_applicant_message` is the ONE place the "20 messages per organisation per UTC day" limit is decided, and it must check and act in ONE
 * database step: a count in JS and then an insert lets two overlapping sends both pass at 19. The scheduling invites (0253) call the same function,
 * so the limit cannot drift between the two. These tests run on a real database and each claim in the list below was proven by a mutant (see the PR).
 *
 *   - 20 claims succeed and the 21st is refused, with no row written
 *   - 25 claims fired at once give exactly 20 winners
 *   - a failed message gives its slot back, once
 *   - the day is the UTC day: yesterday's rows are not counted, a row at today's UTC midnight is
 *   - one organisation's messages never use another's allowance
 *   - the function is service-role only; the log is readable by the organisation's own members only and writable by nobody through the API
 *   - Premium (organization_premium) is admin-set only: no API role can read or write the table or call the function, and every change is audited
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { createClient } from "@supabase/supabase-js";
import { deleteOrgsCascade } from "../support/delete-orgs";

const createAnonClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let ownerA: AuthedTestUser;
let ownerB: AuthedTestUser;
let outsider: AuthedTestUser;
let orgA: string;
let orgB: string;
const orgIds: string[] = [];

async function makeOrg(owner: AuthedTestUser, label: string): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `EMPLOYER-TEST Msg ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture org ${label}: ${error?.message}`);
  orgIds.push(data.id);
  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: data.id, user_id: owner.id, role: "owner" });
  if (memberError) throw new Error(`fixture membership ${label}: ${memberError.message}`);
  return data.id;
}

type ClaimArgs = { organization?: string; sender?: string; kind?: string; limit?: number };

async function claim({ organization = orgA, sender = ownerA.id, kind = "custom", limit }: ClaimArgs = {}) {
  return admin.rpc("claim_applicant_message", {
    p_organization_id: organization,
    p_application_id: null as unknown as string,
    p_job_posting_id: null as unknown as string,
    p_sender_user_id: sender,
    p_kind: kind,
    p_subject: "Subject",
    p_body: "Body",
    ...(limit === undefined ? {} : { p_daily_limit: limit }),
  });
}

async function countRows(organization: string, statuses?: string[]): Promise<number> {
  let query = admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", organization);
  if (statuses) query = query.in("status", statuses);
  const { count, error } = await query;
  if (error) throw new Error(`count: ${error.message}`);
  return count ?? 0;
}

async function resetOrg(organization: string) {
  const { error } = await admin.from("applicant_messages").delete().eq("organization_id", organization);
  if (error) throw new Error(`reset: ${error.message}`);
}

/** Midnight at the start of today, UTC. */
function utcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

beforeAll(async () => {
  [ownerA, ownerB, outsider] = await Promise.all([
    createAuthedTestUser("amsg-owner-a"),
    createAuthedTestUser("amsg-owner-b"),
    createAuthedTestUser("amsg-outsider"),
  ]);
  orgA = await makeOrg(ownerA, "A");
  orgB = await makeOrg(ownerB, "B");
});

afterAll(async () => {
  if (orgIds.length) await deleteOrgsCascade(admin, orgIds);
  await deleteTestUsers([ownerA?.id, ownerB?.id, outsider?.id].filter(Boolean) as string[]);
});

describe("the daily limit (20 per organisation per UTC day)", () => {
  it("lets 20 through and refuses the 21st, writing no row for it", async () => {
    await resetOrg(orgA);
    for (let i = 0; i < 20; i += 1) {
      const { data, error } = await claim();
      expect(error, `claim ${i + 1}`).toBeNull();
      expect(data, `claim ${i + 1} gets an id`).toBeTruthy();
    }
    const { data, error } = await claim();
    expect(error).toBeNull();
    expect(data, "the 21st claim is refused (null id)").toBeNull();
    expect(await countRows(orgA), "and nothing was written for it").toBe(20);
  });

  it("honours a smaller explicit limit", async () => {
    await resetOrg(orgA);
    expect((await claim({ limit: 2 })).data).toBeTruthy();
    expect((await claim({ limit: 2 })).data).toBeTruthy();
    expect((await claim({ limit: 2 })).data).toBeNull();
  });

  it("60 claims at once, five rounds, give exactly 20 winners each time (one database step, not count-then-insert)", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetOrg(orgA);
      const results = await Promise.all(Array.from({ length: 60 }, () => claim()));
      expect(results.every((r) => r.error === null), JSON.stringify(results.map((r) => r.error).filter(Boolean))).toBe(true);
      expect(results.filter((r) => r.data).length, `round ${round + 1}: exactly 20 got an id`).toBe(20);
      expect(await countRows(orgA), `round ${round + 1}: exactly 20 rows exist`).toBe(20);
    }
  });

  it("60 claims at once split across message and invite kinds still give exactly 20 winners (messages and interview invites share ONE counter)", async () => {
    for (let round = 0; round < 3; round += 1) {
      await resetOrg(orgA);
      const results = await Promise.all(Array.from({ length: 60 }, (_, i) => claim({ kind: i % 2 === 0 ? "interview_invite" : "invite_interview" })));
      expect(results.every((r) => r.error === null)).toBe(true);
      expect(results.filter((r) => r.data).length, `round ${round + 1}: exactly 20 got an id`).toBe(20);
      const { data: rows } = await admin.from("applicant_messages").select("kind").eq("organization_id", orgA);
      expect(rows, "and both kinds were counted against the same day").toHaveLength(20);
    }
  });

  it("a FAILED message gives its slot back; a claimed or sent one keeps it", async () => {
    await resetOrg(orgA);
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) ids.push((await claim()).data as string);
    expect((await claim()).data, "full").toBeNull();

    const { error } = await admin.from("applicant_messages").update({ status: "failed", failure_reason: "send failed" }).eq("id", ids[0]);
    expect(error).toBeNull();
    const again = await claim();
    expect(again.data, "the freed slot can be claimed again").toBeTruthy();
    expect((await claim()).data, "but only once").toBeNull();
    expect(await countRows(orgA, ["claimed", "sent"]), "20 live rows").toBe(20);

    const { error: sentError } = await admin.from("applicant_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", ids[1]);
    expect(sentError).toBeNull();
    expect((await claim()).data, "a sent message still holds its slot").toBeNull();
  });

  it("counts the UTC day: yesterday's rows are free, a row at today's UTC midnight is counted", async () => {
    await resetOrg(orgA);
    const midnight = utcMidnight();
    const justBefore = new Date(midnight.getTime() - 1000).toISOString();
    const seed = (createdAt: string, n: number) =>
      Array.from({ length: n }, () => ({
        organization_id: orgA,
        sender_user_id: ownerA.id,
        kind: "custom",
        subject: "s",
        body: "b",
        status: "sent",
        created_at: createdAt,
      }));
    const { error: yesterdayError } = await admin.from("applicant_messages").insert(seed(justBefore, 20));
    expect(yesterdayError).toBeNull();
    expect((await claim()).data, "20 rows one second before UTC midnight do not count today").toBeTruthy();

    await resetOrg(orgA);
    const { error: todayError } = await admin.from("applicant_messages").insert(seed(midnight.toISOString(), 20));
    expect(todayError).toBeNull();
    expect((await claim()).data, "20 rows AT UTC midnight are today's").toBeNull();
  });

  it("one organisation's messages never use another's allowance", async () => {
    await resetOrg(orgA);
    await resetOrg(orgB);
    for (let i = 0; i < 20; i += 1) await claim({ organization: orgA });
    expect((await claim({ organization: orgA })).data).toBeNull();
    expect((await claim({ organization: orgB, sender: ownerB.id })).data, "org B is untouched by A being full").toBeTruthy();
  });

  it("interview invites share the limit: the same function, kind 'interview_invite'", async () => {
    await resetOrg(orgA);
    for (let i = 0; i < 10; i += 1) await claim({ kind: "invite_interview" });
    for (let i = 0; i < 10; i += 1) await claim({ kind: "interview_invite" });
    expect((await claim()).data, "10 + 10 of mixed kinds fill the day").toBeNull();
  });

  it("refuses a kind that is not one of the known ones", async () => {
    await resetOrg(orgA);
    const { error } = await claim({ kind: "spam" });
    expect(error, "unknown kind is a check violation").not.toBeNull();
  });
});

describe("when a candidate is deleted (owner decision): the row stays, subject and body are blanked", () => {
  async function loggedMessageFor(applicationId: string, status: "claimed" | "sent") {
    const { data, error } = await admin
      .from("applicant_messages")
      .insert({ organization_id: orgA, application_id: applicationId, sender_user_id: ownerA.id, kind: "invite_interview", subject: "Interview for Joy", body: "Hi Joy, welcome.", status, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) })
      .select("id, created_at")
      .single();
    if (error || !data) throw new Error(`message: ${error?.message}`);
    return data;
  }
  async function fixtureApplication(): Promise<{ userId: string; applicationId: string; jobId: string }> {
    const { data: created, error } = await admin.auth.admin.createUser({ email: `amsg-del-${randomUUID().slice(0, 8)}@talentrah.test`, email_confirm: true });
    if (error || !created.user) throw new Error(`user: ${error?.message}`);
    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({ source_type: "internal", organization_id: orgA, company_name: "EMPLOYER-TEST Co", title: "Del role", description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
      .select("id")
      .single();
    if (jobError || !job) throw new Error(`job: ${jobError?.message}`);
    const { data: app, error: appError } = await admin.from("applications").insert({ user_id: created.user.id, job_posting_id: job.id, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
    if (appError || !app) throw new Error(`application: ${appError?.message}`);
    return { userId: created.user.id, applicationId: app.id, jobId: job.id };
  }

  it("deleting the CANDIDATE ACCOUNT keeps the row (kind, sender, organisation, status, times), detaches the application, blanks subject and body, and the day's count is unchanged", async () => {
    await resetOrg(orgA);
    const { userId, applicationId } = await fixtureApplication();
    const sent = await loggedMessageFor(applicationId, "sent");
    const claimed = await loggedMessageFor(applicationId, "claimed");
    const before = await countRows(orgA, ["claimed", "sent"]);

    const { error } = await admin.auth.admin.deleteUser(userId);
    expect(error).toBeNull();

    const { data: rows } = await admin.from("applicant_messages").select("id, application_id, subject, body, kind, status, sender_user_id, organization_id, created_at, sent_at").in("id", [sent.id, claimed.id]);
    expect(rows).toHaveLength(2);
    for (const row of rows!) {
      expect(row.application_id, "the link to the application is gone").toBeNull();
      expect(row.subject).toBe("");
      expect(row.body).toBe("");
      expect(row.kind).toBe("invite_interview");
      expect(row.organization_id).toBe(orgA);
      expect(row.sender_user_id).toBe(ownerA.id);
    }
    expect(rows!.find((r) => r.id === sent.id)!.status).toBe("sent");
    expect(rows!.find((r) => r.id === sent.id)!.sent_at).toBeTruthy();
    expect(await countRows(orgA, ["claimed", "sent"]), "the daily count still includes both").toBe(before);
    expect((await claim()).data, "and the slots they used stay used").toBeTruthy();
  });

  it("deleting the APPLICATION directly (any other path) blanks the messages of that application only", async () => {
    await resetOrg(orgA);
    const one = await fixtureApplication();
    const two = await fixtureApplication();
    const mine = await loggedMessageFor(one.applicationId, "sent");
    const theirs = await loggedMessageFor(two.applicationId, "sent");
    expect((await admin.from("applications").delete().eq("id", one.applicationId)).error).toBeNull();
    const { data: a } = await admin.from("applicant_messages").select("application_id, subject, body").eq("id", mine.id).single();
    expect(a).toEqual({ application_id: null, subject: "", body: "" });
    const { data: b } = await admin.from("applicant_messages").select("application_id, subject, body").eq("id", theirs.id).single();
    expect(b).toMatchObject({ application_id: two.applicationId, subject: "Interview for Joy", body: "Hi Joy, welcome." });
    await admin.auth.admin.deleteUser(one.userId);
    await admin.auth.admin.deleteUser(two.userId);
  });

  it("the blanking function is not callable by an employer's session or an anonymous caller", async () => {
    const asMember = await ownerA.client.rpc("blank_applicant_messages_on_application_delete" as never);
    expect(asMember.error).not.toBeNull();
    const asAnon = await createAnonClient().rpc("blank_applicant_messages_on_application_delete" as never);
    expect(asAnon.error).not.toBeNull();
  });
});

describe("who can reach the function and the log", () => {
  it("claim_applicant_message is service-role only: a signed-in member and an anonymous caller are refused", async () => {
    const args = {
      p_organization_id: orgA,
      p_application_id: null as unknown as string,
      p_job_posting_id: null as unknown as string,
      p_sender_user_id: ownerA.id,
      p_kind: "custom",
      p_subject: "s",
      p_body: "b",
    };
    // A limit of 0 means a call that gets in does nothing and returns null WITHOUT an error, so only a refusal to execute at all shows as an error.
    const asMember = await ownerA.client.rpc("claim_applicant_message", { ...args, p_daily_limit: 0 });
    expect(asMember.error, "an org member cannot call it with their own session").not.toBeNull();
    expect(asMember.data).toBeNull();
    const asAnon = await createAnonClient().rpc("claim_applicant_message", { ...args, p_daily_limit: 0 });
    expect(asAnon.error, "an anonymous caller cannot call it").not.toBeNull();
  });

  it("an organisation's members can read its own log; another organisation's members and outsiders see nothing", async () => {
    await resetOrg(orgA);
    await claim();
    const own = await ownerA.client.from("applicant_messages").select("id").eq("organization_id", orgA);
    expect(own.error).toBeNull();
    expect(own.data?.length, "own organisation's row is visible").toBe(1);
    const other = await ownerB.client.from("applicant_messages").select("id").eq("organization_id", orgA);
    expect(other.data ?? [], "another organisation sees none of it").toHaveLength(0);
    const stranger = await outsider.client.from("applicant_messages").select("id").eq("organization_id", orgA);
    expect(stranger.data ?? [], "a signed-in non-member sees none of it").toHaveLength(0);
  });

  it("nobody can write the log through the API: insert, update and delete are refused for a member", async () => {
    await resetOrg(orgA);
    const claimed = (await claim()).data as string;
    const insert = await ownerA.client
      .from("applicant_messages")
      .insert({ organization_id: orgA, sender_user_id: ownerA.id, kind: "custom", subject: "s", body: "b" });
    expect(insert.error, "insert refused").not.toBeNull();
    await ownerA.client.from("applicant_messages").update({ status: "failed" }).eq("id", claimed);
    await ownerA.client.from("applicant_messages").delete().eq("id", claimed);
    const { data } = await admin.from("applicant_messages").select("status").eq("id", claimed).single();
    expect(data?.status, "the row is unchanged and still there after a member's update and delete").toBe("claimed");
  });
});

describe("organization_premium: Premium is an admin-set date no employer can touch", () => {
  const farFuture = () => new Date(Date.now() + 86_400_000 * 30).toISOString();
  const adminArgs = (organization: string, until: string | null, reason = "Pilot customer, 30 days") => ({
    p_organization_id: organization,
    p_premium_until: until as unknown as string,
    p_admin_user_id: null as unknown as string,
    p_admin_email: "operator@talentrah.internal",
    p_admin_session_id: null as unknown as string,
    p_reason: reason,
  });
  const premiumRow = async (organization: string) => (await admin.from("organization_premium").select("premium_until").eq("organization_id", organization).maybeSingle()).data;
  const auditCount = async (organization: string) =>
    (await admin.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("target_id", organization).eq("action", "organization.premium_set")).count ?? 0;

  it("an employer's own session can neither read, create, change nor delete a Premium row", async () => {
    const insert = await ownerA.client.from("organization_premium").insert({ organization_id: orgA, premium_until: farFuture() });
    expect(insert.error, "an employer cannot give their own organisation Premium by inserting").not.toBeNull();
    const read = await ownerA.client.from("organization_premium").select("premium_until").eq("organization_id", orgA);
    expect(read.error, "an employer cannot even read the table").not.toBeNull();
    await admin.from("organization_premium").upsert({ organization_id: orgB, premium_until: farFuture() });
    const update = await ownerB.client.from("organization_premium").update({ premium_until: "2099-01-01T00:00:00Z" }).eq("organization_id", orgB);
    expect(update.error).not.toBeNull();
    const del = await ownerB.client.from("organization_premium").delete().eq("organization_id", orgB);
    expect(del.error).not.toBeNull();
    expect(await premiumRow(orgA), "nothing was created for A").toBeNull();
    expect(await premiumRow(orgB), "B's row is untouched").not.toBeNull();
    await admin.from("organization_premium").delete().eq("organization_id", orgB);
  });

  it("an anonymous caller has no access to the table either", async () => {
    const read = await createAnonClient().from("organization_premium").select("premium_until");
    expect(read.error).not.toBeNull();
  });

  it("an employer cannot give their own organisation Premium through the function (RPC refused, nothing created, nothing audited)", async () => {
    const asMember = await ownerA.client.rpc("admin_set_organization_premium", adminArgs(orgA, farFuture(), "I would like Premium"));
    expect(asMember.error, "a signed-in member cannot execute the function").not.toBeNull();
    const asAnon = await createAnonClient().rpc("admin_set_organization_premium", adminArgs(orgA, farFuture(), "I would like Premium"));
    expect(asAnon.error, "an anonymous caller cannot either").not.toBeNull();
    expect(await premiumRow(orgA)).toBeNull();
    expect(await auditCount(orgA)).toBe(0);
  });

  it("the admin function sets the date and writes ONE audit row with who, before, after and why; changing it and ending it are audited too", async () => {
    const until = farFuture();
    const set = await admin.rpc("admin_set_organization_premium", adminArgs(orgA, until));
    expect(set.error).toBeNull();
    expect(new Date((await premiumRow(orgA))!.premium_until).getTime()).toBe(new Date(until).getTime());
    const { data: rows } = await admin.from("admin_audit_log").select("admin_email, target_table, detail").eq("target_id", orgA).eq("action", "organization.premium_set");
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ admin_email: "operator@talentrah.internal", target_table: "organization_premium" });
    expect(rows![0].detail).toMatchObject({ from: null, reason: "Pilot customer, 30 days" });
    expect(new Date((rows![0].detail as { to: string }).to).getTime()).toBe(new Date(until).getTime());

    const later = new Date(Date.now() + 86_400_000 * 60).toISOString();
    expect((await admin.rpc("admin_set_organization_premium", adminArgs(orgA, later, "Extended"))).error).toBeNull();
    expect(new Date((await premiumRow(orgA))!.premium_until).getTime(), "an existing row is updated, not duplicated").toBe(new Date(later).getTime());
    expect((await admin.rpc("admin_set_organization_premium", adminArgs(orgA, null, "Ended"))).error).toBeNull();
    expect(await premiumRow(orgA), "a null date ends Premium").toBeNull();
    expect(await auditCount(orgA), "three audited changes").toBe(3);
  });

  it("the admin function refuses a missing reason, a missing identity and an unknown organisation, changing and auditing nothing", async () => {
    expect((await admin.rpc("admin_set_organization_premium", adminArgs(orgB, farFuture(), "  "))).error).not.toBeNull();
    expect((await admin.rpc("admin_set_organization_premium", { ...adminArgs(orgB, farFuture()), p_admin_email: "" })).error).not.toBeNull();
    expect((await admin.rpc("admin_set_organization_premium", adminArgs(randomUUID(), farFuture()))).error).not.toBeNull();
    expect(await premiumRow(orgB)).toBeNull();
    expect(await auditCount(orgB)).toBe(0);
  });
});
