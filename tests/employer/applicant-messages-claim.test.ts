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
 *   - organizations.premium_until cannot be written by a member (the Farah drafting gate reads it)
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

describe("organizations.premium_until", () => {
  it("is null by default and a member cannot set it (the column carries money-adjacent trust)", async () => {
    const { data: before } = await admin.from("organizations").select("premium_until").eq("id", orgA).single();
    expect(before?.premium_until).toBeNull();

    const attempt = await ownerA.client
      .from("organizations")
      .update({ premium_until: new Date(Date.now() + 86_400_000 * 30).toISOString() })
      .eq("id", orgA);
    expect(attempt.error, "a column-level refusal, not a silent zero-row update").not.toBeNull();

    const { data: after } = await admin.from("organizations").select("premium_until").eq("id", orgA).single();
    expect(after?.premium_until, "still null").toBeNull();
  });

  it("cannot be smuggled in when a member creates an organisation (the INSERT policy requires it to be null), while a normal create still works", async () => {
    const smuggled = await ownerA.client
      .from("organizations")
      .insert({ name: `EMPLOYER-TEST Msg smuggle ${randomUUID().slice(0, 8)}`, created_by: ownerA.id, premium_until: new Date(Date.now() + 86_400_000).toISOString() });
    expect(smuggled.error, "an INSERT that sets premium_until is refused by row level security").not.toBeNull();

    const plain = await ownerA.client
      .from("organizations")
      .insert({ name: `EMPLOYER-TEST Msg plain ${randomUUID().slice(0, 8)}`, created_by: ownerA.id })
      .select("id")
      .single();
    expect(plain.error, "creating an organisation without it still works").toBeNull();
    if (plain.data) orgIds.push(plain.data.id);
  });

  it("an employer cannot give their own organisation Premium through the function either (RPC refused, nothing changes, nothing audited)", async () => {
    const args = {
      p_organization_id: orgA,
      p_premium_until: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      p_admin_user_id: null as unknown as string,
      p_admin_email: ownerA.email,
      p_admin_session_id: null as unknown as string,
      p_reason: "I would like Premium",
    };
    const asMember = await ownerA.client.rpc("admin_set_organization_premium", args);
    expect(asMember.error, "a signed-in member cannot execute the function").not.toBeNull();
    const asAnon = await createAnonClient().rpc("admin_set_organization_premium", args);
    expect(asAnon.error, "an anonymous caller cannot either").not.toBeNull();
    const { data } = await admin.from("organizations").select("premium_until").eq("id", orgA).single();
    expect(data?.premium_until).toBeNull();
    const { count } = await admin.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("target_id", orgA).eq("action", "organization.premium_set");
    expect(count ?? 0).toBe(0);
  });

  it("the admin function sets the date and writes ONE audit row with who, before, after and why; clearing is audited too", async () => {
    const until = new Date(Date.now() + 86_400_000 * 30).toISOString();
    const set = await admin.rpc("admin_set_organization_premium", {
      p_organization_id: orgA,
      p_premium_until: until,
      p_admin_user_id: null as unknown as string,
      p_admin_email: "operator@talentrah.internal",
      p_admin_session_id: null as unknown as string,
      p_reason: "Pilot customer, 30 days",
    });
    expect(set.error).toBeNull();
    const { data: org } = await admin.from("organizations").select("premium_until").eq("id", orgA).single();
    expect(new Date(org!.premium_until!).getTime()).toBe(new Date(until).getTime());
    const { data: rows } = await admin.from("admin_audit_log").select("admin_email, target_table, detail").eq("target_id", orgA).eq("action", "organization.premium_set");
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ admin_email: "operator@talentrah.internal", target_table: "organizations" });
    expect(rows![0].detail).toMatchObject({ from: null, reason: "Pilot customer, 30 days" });
    expect(new Date((rows![0].detail as { to: string }).to).getTime()).toBe(new Date(until).getTime());

    const cleared = await admin.rpc("admin_set_organization_premium", {
      p_organization_id: orgA,
      p_premium_until: null as unknown as string,
      p_admin_user_id: null as unknown as string,
      p_admin_email: "operator@talentrah.internal",
      p_admin_session_id: null as unknown as string,
      p_reason: "Ended",
    });
    expect(cleared.error).toBeNull();
    const { data: after } = await admin.from("organizations").select("premium_until").eq("id", orgA).single();
    expect(after?.premium_until).toBeNull();
    const { count } = await admin.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("target_id", orgA).eq("action", "organization.premium_set");
    expect(count, "the clear is a second audited change").toBe(2);
  });

  it("the admin function refuses a missing reason, a missing identity and an unknown organisation, changing and auditing nothing", async () => {
    const base = {
      p_organization_id: orgB,
      p_premium_until: new Date(Date.now() + 86_400_000).toISOString(),
      p_admin_user_id: null as unknown as string,
      p_admin_email: "operator@talentrah.internal",
      p_admin_session_id: null as unknown as string,
      p_reason: "ok",
    };
    const { data: before } = await admin.from("organizations").select("premium_until").eq("id", orgB).single();
    expect((await admin.rpc("admin_set_organization_premium", { ...base, p_reason: "  " })).error).not.toBeNull();
    expect((await admin.rpc("admin_set_organization_premium", { ...base, p_admin_email: "" })).error).not.toBeNull();
    expect((await admin.rpc("admin_set_organization_premium", { ...base, p_organization_id: randomUUID() })).error).not.toBeNull();
    const { data: after } = await admin.from("organizations").select("premium_until").eq("id", orgB).single();
    expect(after?.premium_until).toBe(before?.premium_until);
    const { count } = await admin.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("target_id", orgB).eq("action", "organization.premium_set");
    expect(count ?? 0).toBe(0);
  });

  it("the service role can set it", async () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const { error } = await admin.from("organizations").update({ premium_until: until }).eq("id", orgB);
    expect(error).toBeNull();
    const { data } = await admin.from("organizations").select("premium_until").eq("id", orgB).single();
    expect(new Date(data!.premium_until!).getTime()).toBe(new Date(until).getTime());
  });
});
