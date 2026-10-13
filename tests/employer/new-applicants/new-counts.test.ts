/**
 * 0259: "N new" applicants per job for an employer's own organisation. New = no employer status yet or status 'new'. Real database, real sessions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, createTestUser, deleteTestUsers, type TestUser } from "../../support/auth";
import { deleteOrgsCascade } from "../../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let ownerA: Authed;
let ownerB: Authed;
const seekers: TestUser[] = [];
let orgA: string;
let orgB: string;
let jobA: string;
let jobA2: string;
let externalJob: string;
const apps: string[] = [];
const orgIds: string[] = [];

async function org(owner: Authed, label: string) {
  const { data, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg newcount ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true }).select("id").single();
  if (error || !data) throw new Error(`org: ${error?.message}`);
  orgIds.push(data.id);
  await admin.from("organization_members").insert({ organization_id: data.id, user_id: owner.id, role: "owner" });
  return data.id;
}
async function job(organizationId: string | null, title: string, external = false) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: external ? "external" : "internal", organization_id: organizationId, company_name: "EMPLOYER-TEST Co", title, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID(), ...(external ? { external_source: "newcount-test", external_url: `https://example.test/${randomUUID()}` } : {}) })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}
async function apply(user: TestUser, jobId: string, applied = true) {
  const { data, error } = await admin
    .from("applications")
    .insert({ user_id: user.id, job_posting_id: jobId, stage: applied ? "applied" : "saved", source: "internal_apply", applied_at: applied ? new Date().toISOString() : null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`application: ${error?.message}`);
  apps.push(data.id);
  return data.id;
}
const counts = async (client: Authed["client"], organizationId: string) => {
  const { data, error } = await client.rpc("employer_new_applicant_counts", { p_organization_id: organizationId });
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r) => [r.job_posting_id, r.new_count]));
};

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createAuthedTestUser("newc-a"), createAuthedTestUser("newc-b")]);
  for (let i = 0; i < 4; i += 1) seekers.push(await createTestUser(`newc-s${i}`));
  orgA = await org(ownerA, "A");
  orgB = await org(ownerB, "B");
  jobA = await job(orgA, "Job A");
  jobA2 = await job(orgA, "Job A2");
  // (job_postings_internal_has_org already forbids an external posting from belonging to an organisation, so the internal-only predicate in 0259 is a second guard, not the only one.)
  externalJob = await job(null, "External", true);
}, 120_000);

afterAll(async () => {
  await admin.from("applications").delete().in("id", apps);
  await deleteOrgsCascade(admin, orgIds);
  await admin.from("job_postings").delete().eq("id", externalJob);
  await deleteTestUsers([ownerA?.id, ownerB?.id, ...seekers.map((s) => s.id)].filter(Boolean) as string[]);
});

describe("employer_new_applicant_counts", () => {
  it("counts submitted applications with no employer status as new, per job; a bookmark is not an applicant", async () => {
    const a1 = await apply(seekers[0], jobA);
    await apply(seekers[1], jobA);
    await apply(seekers[2], jobA2);
    await apply(seekers[3], jobA, false);
    expect(await counts(ownerA.client, orgA)).toEqual({ [jobA]: 2, [jobA2]: 1 });
    expect(a1).toBeTruthy();
  });

  it("an applicant stops being new the moment the employer sets any other status; setting it back to 'new' makes them new again", async () => {
    const { data: row } = await admin.from("applications").select("id").eq("user_id", seekers[0].id).eq("job_posting_id", jobA).single();
    await admin.from("employer_applicant_status").upsert({ application_id: row!.id, status: "reviewing" });
    expect(await counts(ownerA.client, orgA)).toEqual({ [jobA]: 1, [jobA2]: 1 });
    await admin.from("employer_applicant_status").update({ status: "new" }).eq("application_id", row!.id);
    expect(await counts(ownerA.client, orgA)).toEqual({ [jobA]: 2, [jobA2]: 1 });
    await admin.from("employer_applicant_status").update({ status: "not_a_fit" }).eq("application_id", row!.id);
    expect(await counts(ownerA.client, orgA)).toEqual({ [jobA]: 1, [jobA2]: 1 });
  });

  it("another organisation's members get nothing for this organisation, and a member's own organisation shows only its own jobs", async () => {
    expect(await counts(ownerB.client, orgA)).toEqual({});
    expect(await counts(ownerB.client, orgB)).toEqual({});
  });

  it("an external posting never counts", async () => {
    await apply(seekers[0], externalJob);
    expect(await counts(ownerA.client, orgA)).not.toHaveProperty(externalJob);
  });

  it("an anonymous caller cannot execute it", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("employer_new_applicant_counts", { p_organization_id: orgA });
    expect(error).not.toBeNull();
  });
});
