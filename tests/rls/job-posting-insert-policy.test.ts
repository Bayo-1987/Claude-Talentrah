/**
 * 0221: the job_postings INSERT policy definition (#683), read off a real signed-in session of an organisation member, with its positive control: an ordinary posting is accepted.
 *
 * First run of this file is CI (no database on the authoring machine).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let member: Authed;
let orgId = "";
let orgName = "";
const fingerprints: string[] = [];

const posting = (extra: Record<string, unknown> = {}) => {
  const dedup = `policy-0221-${randomUUID()}`;
  fingerprints.push(dedup);
  return { source_type: "internal", organization_id: orgId, company_name: orgName, title: `B0221-TEST ${randomUUID().slice(0, 6)}`, description: "Fixture.", status: "open", dedup_fingerprint: dedup, ...extra };
};

beforeAll(async () => {
  member = await createAuthedTestUser("b0221-member");
  const org = await admin.from("organizations").insert({ name: `B0221-TEST Org ${randomUUID().slice(0, 8)}`, created_by: member.id, verified: true }).select("id, name").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  orgName = org.data.name;
  const mem = await admin.from("organization_members").insert({ organization_id: orgId, user_id: member.id, role: "owner" });
  if (mem.error) throw new Error(`fixture member: ${mem.error.message}`);
}, 240_000);

afterAll(async () => {
  for (const f of fingerprints) await admin.from("job_postings").delete().eq("dedup_fingerprint", f);
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteOrgsCascade(admin, [orgId]);
  }
  if (member) await deleteTestUsers([member.id]);
}, 120_000);

describe("the session is real (so a rejection below is the policy's, not a missing login)", () => {
  it("the member can read their own profile and is a member of the fixture organisation", async () => {
    const own = await member.client.from("profiles").select("id").eq("id", member.id);
    expect(own.error).toBeNull();
    expect(own.data?.map((r) => r.id)).toEqual([member.id]);
    const { data } = await admin.from("organization_members").select("user_id").eq("organization_id", orgId).eq("user_id", member.id);
    expect(data).toHaveLength(1);
  });
});

describe("posting as an organisation member", () => {
  it("POSITIVE CONTROL: an ordinary posting is accepted", async () => {
    const { error } = await member.client.from("job_postings").insert(posting() as never);
    expect(error, "an ordinary posting must still be accepted").toBeNull();
  });

  it("an insert that sets a column outside the policy's definition is rejected by row-level security", async () => {
    const { error } = await member.client.from("job_postings").insert(posting({ banner_path: `${orgId}/${randomUUID()}.png` }) as never);
    expect(error, "the insert must be rejected").not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(error!.message).toMatch(/row-level security/i);
  });

  it("an explicit null for that column is accepted (the same as leaving it out)", async () => {
    const { error } = await member.client.from("job_postings").insert(posting({ banner_path: null }) as never);
    expect(error).toBeNull();
  });

  it("the rejected row was not written", async () => {
    const dedup = `policy-0221-${randomUUID()}`;
    fingerprints.push(dedup);
    await member.client.from("job_postings").insert({ ...posting({ banner_path: `${orgId}/${randomUUID()}.png` }), dedup_fingerprint: dedup } as never);
    const { data } = await admin.from("job_postings").select("id").eq("dedup_fingerprint", dedup);
    expect(data ?? []).toEqual([]);
  });
});
