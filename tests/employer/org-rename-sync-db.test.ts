/**
 * An organisation rename reaches its postings, against a REAL database (migration 0216). Service-role only, so it runs on a hosted
 * test project too; the DB-backed gate is CI's own fresh stack, which applies every migration.
 *
 * The cases are the ones the bug and its blast radius suggest: an internal posting follows a rename whatever its status; nothing
 * else moves (another organisation's posting, an external posting, a posting after a non-name edit); and a same-name write is a no-op.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { runCleanups, mustDelete } from "../support/teardown";

const jobIds: string[] = [];
const orgIds: string[] = [];
let userId = "";
let orgA = "";
let orgB = "";

async function newOrg(label: string): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `ORGRENAME ${label} ${randomUUID().slice(0, 8)}`, created_by: userId, verified: false })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture org: ${error?.message}`);
  orgIds.push(data.id);
  return data.id;
}

async function posting(orgId: string | null, companyName: string, over: Record<string, unknown> = {}): Promise<string> {
  const internal = orgId !== null;
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: internal ? "internal" : "external",
      organization_id: orgId,
      company_name: companyName,
      title: `ORGRENAME Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting owned by tests/employer/org-rename-sync-db.test.ts.",
      structured_jd: {},
      status: "open",
      dedup_fingerprint: randomUUID(),
      ...(internal ? {} : { external_source: "orgrename-test", external_url: `https://example.test/${randomUUID()}` }),
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  jobIds.push(data.id);
  return data.id;
}

const nameOf = async (id: string) => {
  const { data, error } = await admin.from("job_postings").select("company_name").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data.company_name;
};
const rename = async (orgId: string, name: string) => {
  const { error } = await admin.from("organizations").update({ name }).eq("id", orgId);
  if (error) throw new Error(`rename: ${error.message}`);
};

beforeAll(async () => {
  const user = await createTestUser("orgrename");
  userId = user.id;
  orgA = await newOrg("A");
  orgB = await newOrg("B");
}, 60_000);

afterAll(async () => {
  await runCleanups(
    ["postings", async () => {
      if (jobIds.length) await mustDelete("job_postings", admin.from("job_postings").delete().in("id", jobIds));
    }],
    ["organisations", async () => {
      if (orgIds.length) await deleteTestOrgs(orgIds);
    }],
    ["users", async () => {
      if (userId) await deleteTestUsers([userId]);
    }],
  );
}, 60_000);

describe("renaming an organisation", () => {
  it("updates its internal postings' company_name, whatever their status", async () => {
    const open = await posting(orgA, "Old Name");
    const closed = await posting(orgA, "Old Name", { status: "closed" });
    const draft = await posting(orgA, "Old Name", { status: "draft" });
    await rename(orgA, "ORGRENAME New Name");
    expect(await nameOf(open)).toBe("ORGRENAME New Name");
    expect(await nameOf(closed)).toBe("ORGRENAME New Name");
    expect(await nameOf(draft)).toBe("ORGRENAME New Name");
  });

  it("does not touch another organisation's posting", async () => {
    const other = await posting(orgB, "Other Co");
    await rename(orgA, "ORGRENAME Renamed Again");
    expect(await nameOf(other)).toBe("Other Co");
  });

  it("does not touch an external posting, even one that names the same company", async () => {
    const external = await posting(null, "Old Name");
    await rename(orgA, "ORGRENAME Third Name");
    expect(await nameOf(external)).toBe("Old Name");
  });

  it("does nothing when something other than the name is edited", async () => {
    const id = await posting(orgA, "Deliberately Different");
    const { error } = await admin.from("organizations").update({ description: `edited ${randomUUID()}` }).eq("id", orgA);
    expect(error).toBeNull();
    expect(await nameOf(id)).toBe("Deliberately Different");
  });

  it("does nothing when the name is written but unchanged", async () => {
    const { data: org } = await admin.from("organizations").select("name").eq("id", orgA).single();
    const id = await posting(orgA, "Deliberately Different 2");
    await rename(orgA, org!.name);
    expect(await nameOf(id)).toBe("Deliberately Different 2");
  });
});
