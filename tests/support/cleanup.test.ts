/**
 * The teardown has to be tested, because the version that did not work looked
 * exactly like one that did.
 *
 * Every organisation-creating suite called
 * `admin.from("organizations").delete().in("id", createdOrgs)` and discarded
 * the result. `job_postings.organization_id` is NO ACTION, so Postgres refused
 * every one of those deletes, and supabase-js reports that by RESOLVING with
 * `{ data: null, error }` rather than throwing. Nothing failed, nothing was
 * deleted, and 312 fixture organisations accumulated in the live project.
 *
 * The first test below is the bug, pinned: if `job_postings.organization_id`
 * is ever changed to CASCADE, it starts failing and this file is the prompt to
 * simplify the helper rather than discover the change by accident.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "./auth";
import { deleteTestOrgs } from "./cleanup";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function orgWithPosting(): Promise<string> {
  const user = await createTestUser("teardown");
  createdUsers.push(user.id);

  const { data: org, error } = await admin
    .from("organizations")
    .insert({
      name: `Teardown Co ${randomUUID().slice(0, 8)}`,
      domain: `camp-${randomUUID().slice(0, 8)}.example`,
      created_by: user.id,
      verified: false,
    })
    .select("id")
    .single();
  if (error) throw error;
  createdOrgs.push(org.id);

  const { error: jobErr } = await admin.from("job_postings").insert({
    source_type: "internal",
    organization_id: org.id,
    title: `Teardown Role ${randomUUID().slice(0, 6)}`,
    company_name: "Teardown Co",
    description: "x",
    structured_jd: {},
    status: "open",
    posted_at: new Date().toISOString(),
    dedup_fingerprint: randomUUID(),
  });
  if (jobErr) throw jobErr;

  return org.id;
}

afterAll(async () => {
  await deleteTestOrgs(createdOrgs);
  await deleteTestUsers(createdUsers);
}, 60_000);

const exists = async (id: string) =>
  ((await admin.from("organizations").select("id").eq("id", id)).data ?? []).length > 0;

describe("organisation teardown", () => {
  it("LEAK: the naive delete every suite used is refused and reports it only in `error`", async () => {
    const id = await orgWithPosting();

    const { error } = await admin.from("organizations").delete().eq("id", id);

    // Two halves, and the second is the reason this went unnoticed for months:
    // there IS an error, and the call did NOT throw. A caller that ignores the
    // return value sees a successful-looking `await`.
    expect(error, "the FK that blocks org deletion is gone — simplify cleanup.ts").not.toBeNull();
    expect(error!.code, "expected a foreign-key violation").toBe("23503");
    expect(error!.message).toContain("job_postings");
    expect(await exists(id), "the org survived, silently").toBe(true);
  });

  it("deleteTestOrgs actually removes the org and its blocking rows", async () => {
    const id = await orgWithPosting();
    expect(await exists(id)).toBe(true);

    await deleteTestOrgs([id]);

    expect(await exists(id), "teardown did not delete the organisation").toBe(false);
    const { data: leftoverJobs } = await admin
      .from("job_postings")
      .select("id")
      .eq("organization_id", id);
    expect(leftoverJobs ?? [], "job postings outlived their organisation").toHaveLength(0);
  });

  it("throws rather than failing quietly, so a broken teardown fails the suite", async () => {
    // The property that matters more than the FK order: a teardown that cannot
    // do its job must say so. Pointed at a column that does not exist, which is
    // how a future schema change would break this.
    await expect(deleteTestOrgs(["not-a-uuid"])).rejects.toThrow(/test teardown failed/);
  });

  it("is a no-op on an empty list", async () => {
    await expect(deleteTestOrgs([])).resolves.toBeUndefined();
  });
});
