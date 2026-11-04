/**
 * 0275 (PR-E2a): set_job_apply_email and the audit table, read off real sessions. DATABASE-BACKED: written here, run by S3-21 on a local stack (this machine has no database), then by CI.
 *
 * What it pins: an organisation member can set, change and clear the address and each real change writes one audit row; nobody else can (a non-member, a signed-out caller, a direct UPDATE);
 * an external posting is refused; a switch to email is refused once an internal_apply or auto_apply application exists and allowed with only a manual one; the sixth change in 24 hours is refused;
 * a malformed address is refused; an unchanged value writes nothing; and no API role can read the audit table. The INSERT-policy half is in job-posting-insert-policy.test.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade, deletePostingsCascade } from "../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let member: Authed;
let outsider: Authed;
let seeker: Authed;
let orgId = "";
let orgName = "";
const jobIds: string[] = [];
const ADDR = "careers@example.test";
const call = (client: Authed["client"], jobId: string, address: string | null) => client.rpc("set_job_apply_email", { p_job_id: jobId, p_address: address as never });
const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function makeJob(extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: orgId, company_name: orgName, title: `B0275-TEST ${randomUUID().slice(0, 6)}`, description: "Fixture.", status: "open", dedup_fingerprint: `b0275-${randomUUID()}`, ...extra } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture job: ${error?.message}`);
  jobIds.push(data.id);
  return data.id;
}
const addressOf = async (id: string) => (await admin.from("job_postings").select("apply_email").eq("id", id).single()).data?.apply_email ?? null;
const eventsOf = async (id: string) => (await admin.from("job_posting_apply_email_events").select("*").eq("job_posting_id", id).order("created_at")).data ?? [];

beforeAll(async () => {
  member = await createAuthedTestUser("b0275-member");
  outsider = await createAuthedTestUser("b0275-outsider");
  seeker = await createAuthedTestUser("b0275-seeker");
  const org = await admin.from("organizations").insert({ name: `B0275-TEST Org ${randomUUID().slice(0, 8)}`, created_by: member.id, verified: true }).select("id, name").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  orgName = org.data.name;
  // role "admin" on purpose: the rule is any member, not the owner.
  const mem = await admin.from("organization_members").insert({ organization_id: orgId, user_id: member.id, role: "admin" });
  if (mem.error) throw new Error(`fixture member: ${mem.error.message}`);
}, 240_000);

afterAll(async () => {
  await deletePostingsCascade(admin, jobIds);
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteOrgsCascade(admin, [orgId]);
  }
  await deleteTestUsers([member, outsider, seeker].filter(Boolean).map((u) => u.id));
}, 120_000);

describe("a member of the organisation (any role) sets, changes and clears the address", () => {
  it("POSITIVE CONTROL: sets it, and exactly one audit row records who, from what and to what", async () => {
    const id = await makeJob();
    const { error } = await call(member.client, id, ADDR);
    expect(error, "a member must be able to set the address").toBeNull();
    expect(await addressOf(id)).toBe(ADDR);
    const rows = await eventsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job_posting_id: id, organization_id: orgId, actor_user_id: member.id, old_address: null, new_address: ADDR });
  });

  it("changes it and clears it (null), one audit row each", async () => {
    const id = await makeJob();
    expect((await call(member.client, id, ADDR)).error).toBeNull();
    expect((await call(member.client, id, "jobs@example.test")).error).toBeNull();
    expect((await call(member.client, id, null)).error).toBeNull();
    expect(await addressOf(id)).toBeNull();
    const rows = await eventsOf(id);
    expect(rows.map((r) => [r.old_address, r.new_address])).toEqual([[null, ADDR], [ADDR, "jobs@example.test"], ["jobs@example.test", null]]);
  });

  it("an unchanged value writes no audit row and uses none of the cap", async () => {
    const id = await makeJob();
    expect((await call(member.client, id, ADDR)).error).toBeNull();
    for (let i = 0; i < 8; i += 1) expect((await call(member.client, id, ADDR)).error).toBeNull();
    expect(await eventsOf(id)).toHaveLength(1);
    // Eight repeats used nothing: four more real changes still fit under the cap of five.
    for (const a of ["u1@example.test", "u2@example.test", "u3@example.test", "u4@example.test"]) expect((await call(member.client, id, a)).error).toBeNull();
    expect(await eventsOf(id)).toHaveLength(5);
  });
});

describe("nobody else can change it", () => {
  it("a signed-in user outside the organisation is refused (42501) and nothing changes", async () => {
    const id = await makeJob();
    const { error } = await call(outsider.client, id, ADDR);
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("That job was not found.");
    expect(await addressOf(id)).toBeNull();
    expect(await eventsOf(id)).toHaveLength(0);
  });

  it("a signed-out caller cannot execute the function at all", async () => {
    const id = await makeJob();
    const { error } = await anon.rpc("set_job_apply_email", { p_job_id: id, p_address: ADDR });
    expect(error, "anon must not be able to call it").not.toBeNull();
    expect(await addressOf(id)).toBeNull();
  });

  it("a direct UPDATE of the column by a member is refused and the value is unchanged", async () => {
    const id = await makeJob();
    const { error } = await member.client.from("job_postings").update({ apply_email: ADDR } as never).eq("id", id);
    expect(error, "no column grant covers apply_email").not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(await addressOf(id)).toBeNull();
  });

  it("an external posting is refused (AE004)", async () => {
    const id = await makeJob({ source_type: "external", organization_id: null, external_url: "https://example.test/j", external_source: "test" });
    const { error } = await call(member.client, id, ADDR);
    expect(error).not.toBeNull();
    expect(["42501", "AE004"]).toContain(error!.code);
    expect(await addressOf(id)).toBeNull();
  });
});

describe("a malformed address is refused (AE003) and nothing is written", () => {
  for (const bad of ["not-an-address", "A@b.co", "a@b", "a b@c.co", "a@b.co?cc=x", "a%0ABcc:x@b.co", "a,b@c.co", "<a@b.co>", "a@@b.co", "a..b@c.co", ".a@b.co", "a@-b.co", `${"a".repeat(65)}@b.co`, "", "é@b.co"]) {
    it(`refuses ${JSON.stringify(bad)}`, async () => {
      const id = await makeJob();
      const { error } = await call(member.client, id, bad);
      expect(error?.code).toBe("AE003");
      expect(error?.message).toBe("Enter one email address, such as careers@yourcompany.com.");
      expect(await addressOf(id)).toBeNull();
      expect(await eventsOf(id)).toHaveLength(0);
    });
  }
});

describe("a switch to email is refused once the job has an in-app application (AE001)", () => {
  const applyAs = async (id: string, source: "internal_apply" | "auto_apply" | "manual") => {
    const { error } = await admin.from("applications").insert({ user_id: seeker.id, job_posting_id: id, stage: "applied", source, applied_at: new Date().toISOString() } as never);
    if (error) throw new Error(`fixture application: ${error.message}`);
  };

  for (const source of ["internal_apply", "auto_apply"] as const) {
    it(`an ${source} application blocks the switch, with the plain sentence`, async () => {
      const id = await makeJob();
      await applyAs(id, source);
      const { error } = await call(member.client, id, ADDR);
      expect(error?.code).toBe("AE001");
      expect(error?.message).toBe("This job already has applications on Talentrah, so it can't be switched to email. Close it and post a new job instead.");
      expect(await addressOf(id)).toBeNull();
      expect(await eventsOf(id)).toHaveLength(0);
    });
  }

  it("a manual row (the seeker's own tracker entry) does not block it", async () => {
    const id = await makeJob();
    await applyAs(id, "manual");
    expect((await call(member.client, id, ADDR)).error).toBeNull();
    expect(await addressOf(id)).toBe(ADDR);
  });

  it("clearing an address is never refused, even with an in-app application on the job", async () => {
    const id = await makeJob({ apply_email: ADDR });
    await applyAs(id, "internal_apply");
    expect((await call(member.client, id, null)).error).toBeNull();
    expect(await addressOf(id)).toBeNull();
  });
});

describe("at most 5 changes per job per 24 hours (AE002)", () => {
  it("the sixth real change is refused with the plain sentence and changes nothing", async () => {
    const id = await makeJob();
    const addresses = ["a1@example.test", "a2@example.test", "a3@example.test", "a4@example.test", "a5@example.test"];
    for (const a of addresses) expect((await call(member.client, id, a)).error).toBeNull();
    const sixth = await call(member.client, id, "a6@example.test");
    expect(sixth.error?.code).toBe("AE002");
    expect(sixth.error?.message).toBe("This job's apply method was changed 5 times in the last 24 hours. Try again tomorrow.");
    expect(await addressOf(id)).toBe("a5@example.test");
    expect(await eventsOf(id)).toHaveLength(5);
  });

  it("changes older than 24 hours do not count, and the cap is per job", async () => {
    const old = await makeJob();
    const longAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const aged = Array.from({ length: 5 }, (_, i) => ({ job_posting_id: old, organization_id: orgId, old_address: `o${i}@example.test`, new_address: `n${i}@example.test`, created_at: longAgo }));
    const seeded = await admin.from("job_posting_apply_email_events").insert(aged);
    expect(seeded.error, "service_role may append audit rows").toBeNull();
    expect((await call(member.client, old, ADDR)).error, "five rows older than a day leave the cap untouched").toBeNull();

    const other = await makeJob();
    expect((await call(member.client, other, ADDR)).error, "another job has its own count").toBeNull();
  });
});

describe("the audit table is closed to every API role", () => {
  it("a member and a signed-out caller can neither read nor write it", async () => {
    const id = await makeJob();
    expect((await call(member.client, id, ADDR)).error).toBeNull();
    const read = await member.client.from("job_posting_apply_email_events" as never).select("*");
    expect(read.error, "authenticated has no SELECT").not.toBeNull();
    const write = await member.client.from("job_posting_apply_email_events" as never).insert({ job_posting_id: id, organization_id: orgId, new_address: "x@example.test" } as never);
    expect(write.error, "authenticated has no INSERT").not.toBeNull();
    const anonRead = await anon.from("job_posting_apply_email_events" as never).select("*");
    expect(anonRead.error, "anon has no SELECT").not.toBeNull();
    expect(await eventsOf(id)).toHaveLength(1);
  });
});
