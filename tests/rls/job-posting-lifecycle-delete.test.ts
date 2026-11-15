/**
 * 0279 (JOBS-LIFECYCLE-1, stage 1): public.job_posting_delete_unreferenced and public.job_posting_reference_report, read off real sessions. DATABASE-BACKED: runs against the local per-job database in CI (and
 * on a local stack by S3-21). The catalog-driven matrix of ONE CASE PER FOREIGN KEY, with dummy parents, is tests/sql/job-posting-lifecycle-delete.harness.sql; this file covers the same claims through
 * the API with real rows for the cases that matter most, and holds the LIST honest against the live catalog.
 *
 * What it pins: every foreign key that points at job_postings is checked by the function (and the list below equals the catalog, both ways, so a table added later fails here until someone decides);
 * a closed row nothing references is deleted and its tombstone written in the same call; a closed row with an application (applied or saved) is kept and writes no tombstone; an open row, a closed row
 * with no closed_at and one newer than the cutoff are untouched; two concurrent calls write one tombstone; neither anon nor a signed-in user can call either function; both flags ship OFF.
 * Every delete is checked for its error: a rejected delete resolves with an error, it does not throw.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deletePostingsCascade } from "../support/delete-orgs";
import { JOB_POSTING_EXEMPT_TABLES, JOB_POSTING_REFERENCES } from "../support/job-posting-references";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let seeker: Authed;
const jobIds: string[] = [];
const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const NOW = () => new Date().toISOString();

async function makeJob(over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "external", title: `B0279-TEST ${randomUUID().slice(0, 6)}`, company_name: "B0279 Co", description: "Fixture.", status: "closed", closed_at: daysAgo(2), external_source: "manual-b0279-test", dedup_fingerprint: `b0279-${randomUUID()}`, ...over } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture job: ${error?.message}`);
  jobIds.push(data.id);
  return data.id;
}
const del = (ids: string[], cutoff = NOW()) => admin.rpc("job_posting_delete_unreferenced", { p_ids: ids, p_closed_before: cutoff });
const jobExists = async (id: string) => {
  const { data, error } = await admin.from("job_postings").select("id").eq("id", id);
  expect(error, "reading the job").toBeNull();
  return (data ?? []).length === 1;
};
const tombstones = async (id: string) => {
  const { data, error } = await admin.from("job_posting_tombstones").select("*").eq("job_id", id);
  expect(error, "reading the tombstone").toBeNull();
  return data ?? [];
};

beforeAll(async () => {
  seeker = await createAuthedTestUser("b0279-seeker");
}, 240_000);

afterAll(async () => {
  const { error } = await admin.from("job_posting_tombstones").delete().in("job_id", jobIds);
  if (error) throw new Error(`teardown: tombstones not removed: ${error.message}`);
  await deletePostingsCascade(admin, jobIds);
  if (seeker) await deleteTestUsers([seeker.id]);
}, 120_000);

describe("the list of references is the catalog's, and the function checks every one", () => {
  it("POSITIVE CONTROL: the report answers for the service role", async () => {
    const { data, error } = await admin.rpc("job_posting_reference_report");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("every foreign key into job_postings is CHECKED by job_posting_delete_unreferenced or EXEMPT, and none is both (an unclassified one fails here, by name: a new table forces a decision)", async () => {
    const { data, error } = await admin.rpc("job_posting_reference_report");
    expect(error).toBeNull();
    const rows = data ?? [];
    const unclassified = rows.filter((r) => !r.checked && !r.exempt).map((r) => `${r.referencing_table}.${r.referencing_column}`);
    expect(unclassified, "neither checked by the delete function nor exempt").toEqual([]);
    const both = rows.filter((r) => r.checked && r.exempt).map((r) => `${r.referencing_table}.${r.referencing_column}`);
    expect(both, "exempt tables must not be checked").toEqual([]);
  });

  it("the exempt tables are exactly the five the Reviewer ruled, and each cascades or nulls with the job", async () => {
    const { data } = await admin.rpc("job_posting_reference_report");
    const exempt = (data ?? []).filter((r) => r.exempt);
    expect(exempt.map((r) => r.referencing_table).sort()).toEqual([...JOB_POSTING_EXEMPT_TABLES].sort());
    for (const r of exempt) expect(["CASCADE", "SET NULL"], `${r.referencing_table}`).toContain(r.on_delete);
  });

  it("the live catalog equals the list in tests/support/job-posting-references.ts, both ways (a new referencing table must be added there, and to the function, on purpose)", async () => {
    const { data } = await admin.rpc("job_posting_reference_report");
    const live = (data ?? []).map((r) => `${r.referencing_table}.${r.referencing_column}`).sort();
    const known = JOB_POSTING_REFERENCES.map(([t, c]) => `${t}.${c}`).sort();
    expect(live.filter((x) => !known.includes(x)), "in the catalog, not in the list").toEqual([]);
    expect(known.filter((x) => !live.includes(x)), "in the list, not in the catalog").toEqual([]);
    expect(live).toHaveLength(20);
  });
});

describe("what is deleted, and what is kept", () => {
  it("POSITIVE CONTROL: a closed row nothing references is deleted, and its tombstone is written in the same call", async () => {
    const id = await makeJob();
    const { data, error } = await del([id]);
    expect(error, "the call must succeed").toBeNull();
    expect((data ?? []).map((r) => r.deleted_job_id)).toEqual([id]);
    expect(await jobExists(id)).toBe(false);
    const rows = await tombstones(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job_id: id, company_name: "B0279 Co", external_source: "manual-b0279-test" });
    expect((rows[0].row_snapshot as Record<string, unknown>).id).toBe(id);
    expect(rows[0].dedup_fingerprint).toMatch(/^b0279-/);
    expect(rows[0].closed_at).not.toBeNull();
  });

  it("a job whose only reference is a match_scores row IS deleted, and that row goes with it", async () => {
    const id = await makeJob();
    const ins = await admin.from("match_scores").insert({ user_id: seeker.id, job_posting_id: id, score: 80, tier: "excellent", explanation: {} } as never);
    expect(ins.error, "fixture match score").toBeNull();
    const { data, error } = await del([id]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.deleted_job_id)).toEqual([id]);
    expect(await jobExists(id)).toBe(false);
    expect(await tombstones(id)).toHaveLength(1);
    const left = await admin.from("match_scores").select("job_posting_id").eq("job_posting_id", id);
    expect(left.error).toBeNull();
    expect(left.data ?? [], "the score went with the job").toEqual([]);
  });

  it("an application keeps the job, applied or saved, and no tombstone is written", async () => {
    for (const stage of ["applied", "saved"] as const) {
      const id = await makeJob();
      const ins = await admin.from("applications").insert({ user_id: seeker.id, job_posting_id: id, stage, source: "manual", applied_at: stage === "applied" ? NOW() : null } as never);
      expect(ins.error, `fixture application (${stage})`).toBeNull();
      const { data, error } = await del([id]);
      expect(error).toBeNull();
      expect(data ?? [], `${stage}: nothing deleted`).toEqual([]);
      expect(await jobExists(id), `${stage}: the job is still there`).toBe(true);
      expect(await tombstones(id), `${stage}: no tombstone`).toEqual([]);
    }
  });

  it("an open row, a closed row with no closed_at and a closed row newer than the cutoff are untouched", async () => {
    const open = await makeJob({ status: "open", closed_at: null });
    const noStamp = await makeJob({ closed_at: null });
    const recent = await makeJob({ closed_at: daysAgo(0) });
    const { data, error } = await del([open, noStamp, recent], daysAgo(1));
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
    for (const id of [open, noStamp, recent]) {
      expect(await jobExists(id)).toBe(true);
      expect(await tombstones(id)).toEqual([]);
    }
  });

  it("only the ids it is given: a row outside p_ids is untouched, and a second call deletes nothing and writes no second tombstone", async () => {
    const a = await makeJob();
    const b = await makeJob();
    expect((await del([a])).data?.map((r) => r.deleted_job_id)).toEqual([a]);
    expect(await jobExists(b)).toBe(true);
    expect((await del([a])).data ?? []).toEqual([]);
    expect(await tombstones(a)).toHaveLength(1);
  });

  it("two concurrent calls for the same row delete it once and write ONE tombstone", async () => {
    const id = await makeJob();
    const [x, y] = await Promise.all([del([id]), del([id])]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([...(x.data ?? []), ...(y.data ?? [])].map((r) => r.deleted_job_id)).toEqual([id]);
    expect(await tombstones(id)).toHaveLength(1);
  });
});

describe("who can call it, and the flags", () => {
  it("anon and a signed-in user cannot execute the delete function or the report", async () => {
    const id = await makeJob();
    for (const [who, client] of [["anon", anon], ["authenticated", seeker.client]] as const) {
      const d = await client.rpc("job_posting_delete_unreferenced", { p_ids: [id], p_closed_before: NOW() });
      expect(d.error, `${who}: delete`).not.toBeNull();
      const r = await client.rpc("job_posting_reference_report");
      expect(r.error, `${who}: report`).not.toBeNull();
    }
    expect(await jobExists(id), "nothing was deleted by the refused calls").toBe(true);
  });

  it("the two lifecycle flags exist and are OFF", async () => {
    const { data, error } = await admin.from("feature_flags").select("key, enabled").in("key", ["job_lifecycle_close_imports", "job_lifecycle_delete_unreferenced"]);
    expect(error).toBeNull();
    expect((data ?? []).map((f) => f.key).sort()).toEqual(["job_lifecycle_close_imports", "job_lifecycle_delete_unreferenced"]);
    expect((data ?? []).every((f) => f.enabled === false)).toBe(true);
  });

  it("the tombstone and run tables are closed to anon and signed-in users", async () => {
    for (const table of ["job_posting_tombstones", "job_posting_lifecycle_runs"] as const) {
      for (const [who, client] of [["anon", anon], ["authenticated", seeker.client]] as const) {
        const { data, error } = await client.from(table).select("*").limit(1);
        expect(error, `${who} reading ${table}`).not.toBeNull();
        expect(data ?? []).toEqual([]);
      }
    }
  });
});
