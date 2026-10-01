/**
 * S12 (b) — superseding same-location duplicates, against the live test database.
 *
 * THE RULE (founder-approved 2026-10-01). Two OPEN external postings are the same job when company, title, location and
 * description are all the same (case and whitespace aside). The freshest is kept; the rest are SUPERSEDED, not deleted:
 * `superseded_by` -> the kept row, `superseded_at` set, `status` untouched. A per-city variant (same text, different
 * location) is NOT a duplicate and is never touched. A description under 80 characters is not evidence of sameness.
 *
 * WHAT "SUPERSEDED" MUST DO, each pinned below: vanish from every public read path (policy-level, so the invoker
 * functions inherit it — feed, search RPC, landing facets, sitemap; and the DEFINER paths — Auto-Apply claim, promoted
 * jobs — filter it explicitly, because a DEFINER function does not inherit the policy), resolve to its kept row for the
 * 308, keep rendering for a Tracker row that points at it (snapshot), never be written by a client, and never be
 * un-hidden by ingestion except when its keeper has left the open set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const RUN = randomUUID().slice(0, 8);
const CO = `Supersession Co ${RUN}`;
const DESC = "Run client refurbishment and maintenance projects end to end, owning budget, schedule and the client relationship. ".repeat(2);
const anon: DB = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const created: string[] = [];
/** Every company this file inserted: apply is scoped to them, so a parallel file's fixtures are never touched. */
const companies = new Set<string>();
let n = 0;
async function post(over: Record<string, unknown> = {}) {
  n += 1;
  const url = `https://jobs.example.test/${RUN}/${n}`;
  const row = {
    source_type: "external" as const,
    external_source: "schema-org:test-supersession",
    external_url: url,
    title: "Client Project Manager",
    company_name: CO,
    location: "Remote",
    work_type: "remote" as const,
    description: DESC,
    status: "open" as const,
    posted_at: new Date(Date.now() - 3_600_000 + n * 1000).toISOString(),
    dedup_fingerprint: createHash("sha256").update(`${RUN}|${n}|${JSON.stringify(over)}`).digest("hex"),
    ...over,
  };
  companies.add(row.company_name as string);
  const { data, error } = await admin.from("job_postings").insert(row).select("id, posted_at").single();
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  created.push(data.id);
  return data;
}

const planFor = async () => {
  const { data, error } = await admin.rpc("job_supersession_plan", { p_companies: [...companies] });
  if (error) throw new Error(`plan failed: ${error.message}`);
  return (data ?? []).filter((r) => created.includes(r.job_id));
};
const apply = async () => {
  const { data, error } = await admin.rpc("apply_job_supersession", { p_companies: [...companies] });
  if (error) throw new Error(`apply failed: ${error.message}`);
  return data;
};
const row = async (id: string) =>
  (await admin.from("job_postings").select("id, status, superseded_by, superseded_at").eq("id", id).single()).data!;

afterAll(async () => {
  if (created.length) {
    await admin.from("applications").delete().in("job_posting_id", created);
    await admin.from("auto_apply_queue").delete().in("job_posting_id", created);
    await admin.from("job_postings").update({ superseded_by: null }).in("id", created);
    const { error } = await admin.from("job_postings").delete().in("id", created);
    if (error) process.stdout.write(`supersession test cleanup failed: ${error.message}\n`);
  }
});

describe("the plan", () => {
  let oldest: { id: string }, middle: { id: string }, freshest: { id: string }, otherCity: { id: string }, otherText: { id: string };
  let shortA: { id: string }, shortB: { id: string };
  beforeAll(async () => {
    oldest = await post();
    middle = await post();
    freshest = await post({ posted_at: new Date().toISOString() });
    otherCity = await post({ location: "Remote, South Africa" });
    otherText = await post({ description: `${DESC} A different second paragraph with its own duties.` });
    shortA = await post({ title: "Driver", description: "Drive the van." });
    shortB = await post({ title: "Driver", description: "Drive the van." });
  });

  it("keeps the freshest of an identical group and supersedes the others", async () => {
    const plan = await planFor();
    const mine = plan.filter((p) => [oldest.id, middle.id, freshest.id].includes(p.job_id));
    expect(mine.map((p) => p.job_id).sort()).toEqual([oldest.id, middle.id].sort());
    expect(new Set(mine.map((p) => p.keeper_id))).toEqual(new Set([freshest.id]));
  });

  it("does not touch a per-city variant, a different description, or a too-short description", async () => {
    const touched = new Set((await planFor()).flatMap((p) => [p.job_id, p.keeper_id]));
    for (const id of [otherCity.id, otherText.id, shortA.id, shortB.id]) expect(touched.has(id), id).toBe(false);
  });

  it("the unscoped dry run (what the first marking is reviewed from) sees the whole table without error", async () => {
    const { data, error } = await admin.rpc("job_supersession_plan");
    expect(error).toBeNull();
    expect((data ?? []).filter((r) => created.includes(r.job_id)).length).toBeGreaterThanOrEqual(2);
  });

  it("is a read: planning changes nothing", async () => {
    await planFor();
    for (const id of [oldest.id, middle.id, freshest.id]) expect((await row(id)).superseded_at).toBeNull();
  });
});

describe("applying it", () => {
  let a: { id: string }, b: { id: string }, keep: { id: string };
  const co = `${CO} apply`;
  beforeAll(async () => {
    a = await post({ company_name: co });
    b = await post({ company_name: co });
    keep = await post({ company_name: co, posted_at: new Date().toISOString() });
    await apply();
  });

  it("marks the losers, never the keeper, never deletes, never changes status", async () => {
    for (const id of [a.id, b.id]) {
      const r = await row(id);
      expect(r.superseded_by).toBe(keep.id);
      expect(r.superseded_at).not.toBeNull();
      expect(r.status).toBe("open");
    }
    const k = await row(keep.id);
    expect(k.superseded_by).toBeNull();
    expect(k.superseded_at).toBeNull();
    const { count } = await admin.from("job_postings").select("id", { count: "exact", head: true }).in("id", [a.id, b.id, keep.id]);
    expect(count).toBe(3);
  });

  it("is idempotent", async () => {
    const again = await apply();
    expect(again?.[0]?.superseded ?? 0).toBe(0);
  });

  it("hides the superseded row from an anonymous visitor and from a signed-in one, and still shows the keeper", async () => {
    const user = await createAuthedTestUser("sup-read");
    try {
      for (const client of [anon, user.client]) {
        const { data } = await client.from("job_postings").select("id").in("id", [a.id, b.id, keep.id]);
        expect((data ?? []).map((r) => r.id)).toEqual([keep.id]);
      }
    } finally {
      await deleteTestUsers([user.id]);
    }
  });

  it("the search RPC does not return it", async () => {
    const user = await createAuthedTestUser("sup-search");
    try {
      const { data, error } = await user.client.rpc("search_job_postings", { p_query: "client project manager", p_since: new Date(Date.now() - 30 * 86_400_000).toISOString(), p_source_type: null, p_work_types: null, p_seniorities: null, p_ids: [a.id, b.id, keep.id] } as never);
      expect(error).toBeNull();
      expect((data ?? []).map((r: { id: string }) => r.id)).toEqual([keep.id]);
    } finally {
      await deleteTestUsers([user.id]);
    }
  });

  it("the landing facet count drops by exactly the superseded rows", async () => {
    const floor = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const before = (await anon.rpc("job_landing_facet_counts", { p_floor: floor })).data?.[0]?.remote_count ?? 0;
    const sibling = await post({ company_name: `${co} facet`, posted_at: new Date(Date.now() - 60_000).toISOString() });
    const sibling2 = await post({ company_name: `${co} facet` });
    const mid = (await anon.rpc("job_landing_facet_counts", { p_floor: floor })).data?.[0]?.remote_count ?? 0;
    expect(Number(mid) - Number(before)).toBe(2);
    await apply();
    const after = (await anon.rpc("job_landing_facet_counts", { p_floor: floor })).data?.[0]?.remote_count ?? 0;
    expect(Number(mid) - Number(after)).toBe(1);
    expect([sibling.id, sibling2.id].length).toBe(2);
  });

  it("resolves a superseded id to its kept row, and a normal or unknown id to nothing", async () => {
    expect((await anon.rpc("superseded_job_target", { p_id: a.id })).data).toBe(keep.id);
    expect((await anon.rpc("superseded_job_target", { p_id: keep.id })).data).toBeNull();
    expect((await anon.rpc("superseded_job_target", { p_id: randomUUID() })).data).toBeNull();
  });

  it("an Auto-Apply confirm on a superseded job is refused as closed", async () => {
    const user = await createAuthedTestUser("sup-aa");
    try {
      const { data: q, error } = await admin
        .from("auto_apply_queue")
        .insert({ user_id: user.id, job_posting_id: a.id, match_score: 90, tier: "excellent", source_type: "external" })
        .select("id")
        .single();
      expect(error).toBeNull();
      const { data } = await admin.rpc("auto_apply_claim_submission", {
        p_user_id: user.id, p_queue_id: q!.id, p_min_score: 80, p_daily_cap: 5, p_free_per_week: 5, p_credit_cost: 1, p_has_active_pass: false,
      });
      expect(data?.[0]).toMatchObject({ ok: false, reason: "job_closed" });
    } finally {
      await deleteTestUsers([user.id]);
    }
  });

  it("a pending Auto-Apply review entry for a job that gets superseded is expired, not left as an 'Untitled role'", async () => {
    const co2 = `${co} queue`;
    const loser = await post({ company_name: co2 });
    const winner = await post({ company_name: co2, posted_at: new Date().toISOString() });
    const user = await createAuthedTestUser("sup-queue");
    try {
      const { data: q } = await admin
        .from("auto_apply_queue")
        .insert({ user_id: user.id, job_posting_id: loser.id, match_score: 90, tier: "excellent", source_type: "external" })
        .select("id")
        .single();
      await apply();
      const after = (await admin.from("auto_apply_queue").select("status").eq("id", q!.id).single()).data;
      expect(after?.status).toBe("expired");
      expect(winner.id).not.toBe(loser.id);
    } finally {
      await deleteTestUsers([user.id]);
    }
  });

  it("a Tracker row pointing at it still renders: the embed is empty and the snapshot is intact", async () => {
    const user = await createAuthedTestUser("sup-tracker");
    try {
      const snapshot = { companyName: co, title: "Client Project Manager", location: "Remote", url: "https://jobs.example.test/x" };
      const { error } = await admin.from("applications").insert({
        user_id: user.id, job_posting_id: a.id, stage: "saved", source: "manual", manual_job_snapshot: snapshot,
      });
      expect(error).toBeNull();
      const { data } = await user.client
        .from("applications")
        .select("job_posting_id, manual_job_snapshot, job_postings(company_name, title, location, external_url)")
        .eq("job_posting_id", a.id)
        .single();
      expect(data!.job_postings).toBeNull();
      expect(data!.manual_job_snapshot).toEqual(snapshot);
    } finally {
      await deleteTestUsers([user.id]);
    }
  });
});

describe("when the keeper leaves the open set", () => {
  it("the next apply un-hides the sibling that is now the only open copy", async () => {
    const co = `${CO} keeper-left`;
    const x = await post({ company_name: co });
    const keeper = await post({ company_name: co, posted_at: new Date().toISOString() });
    await apply();
    expect((await row(x.id)).superseded_by).toBe(keeper.id);
    await admin.from("job_postings").update({ status: "closed" }).eq("id", keeper.id);
    await apply();
    const back = await row(x.id);
    expect(back.superseded_at).toBeNull();
    expect(back.superseded_by).toBeNull();
    const { data } = await anon.from("job_postings").select("id").eq("id", x.id);
    expect(data).toHaveLength(1);
  });
});

describe("the sitemap and public pages never list a superseded row", () => {
  it("an anonymous query shaped like sitemap.ts's returns the keeper only", async () => {
    const co = `${CO} sitemap`;
    const a = await post({ company_name: co });
    const keep = await post({ company_name: co, posted_at: new Date().toISOString() });
    await apply();
    const { data } = await anon.from("job_postings").select("id").eq("company_name", co).eq("status", "open");
    expect((data ?? []).map((r) => r.id)).toEqual([keep.id]);
    expect(a.id).not.toBe(keep.id);
  });
});

describe("no client can write supersession", () => {
  it("an authenticated user cannot set it on a row", async () => {
    const user = await createAuthedTestUser("sup-write");
    try {
      const target = await post({ company_name: `${CO} write` });
      const upd = await user.client.from("job_postings").update({ superseded_at: new Date().toISOString() }).eq("id", target.id).select("id");
      expect(upd.data ?? []).toHaveLength(0); // no UPDATE grant on the column, and no policy that reaches an external row
      expect((await row(target.id)).superseded_at).toBeNull();
    } finally {
      await deleteTestUsers([user.id]);
    }
  });

  it("an org member creating their OWN posting cannot carry supersession in (the INSERT is a table-level grant, so the trigger is what stops it)", async () => {
    const user = await createAuthedTestUser("sup-insert");
    const { data: org } = await user.client
      .from("organizations")
      .insert({ name: `SUPERSESSION-TEST ${randomUUID().slice(0, 8)}`, created_by: user.id })
      .select("id")
      .single();
    try {
      await user.client.from("organization_members").insert({ organization_id: org!.id, user_id: user.id, role: "owner" });
      const fields = (label: string) => ({
        source_type: "internal" as const,
        organization_id: org!.id,
        company_name: "SUPERSESSION-TEST Co",
        title: `SUPERSESSION-TEST-${label} ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for the supersession INSERT test.",
        structured_jd: {},
        status: "open" as const,
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      });

      const { data: good, error: goodError } = await user.client.from("job_postings").insert(fields("good")).select("id, superseded_at, superseded_by").single();
      try {
        expect(goodError, "an ordinary posting creation must still succeed").toBeNull();
        expect(good?.superseded_at).toBeNull();
        expect(good?.superseded_by).toBeNull();
      } finally {
        if (good?.id) await admin.from("job_postings").delete().eq("id", good.id);
      }

      const bad = await user.client
        .from("job_postings")
        .insert({ ...fields("bad"), superseded_at: new Date().toISOString() })
        .select("id");
      expect(bad.error?.message ?? "no error", "the refusal must be the supersession trigger's, not an unrelated RLS failure").toMatch(/server-managed/);

      const badBy = await user.client
        .from("job_postings")
        .insert({ ...fields("bad-by"), superseded_by: created[0] ?? randomUUID(), superseded_at: new Date().toISOString() })
        .select("id");
      expect(badBy.error?.message ?? "no error").toMatch(/server-managed/);
    } finally {
      await deleteTestOrgs([org!.id]);
      await deleteTestUsers([user.id]);
    }
  });
});

describe("the function surface", () => {
  it("plan and apply are service-role only", async () => {
    for (const fn of ["job_supersession_plan", "apply_job_supersession"] as const) {
      const r = await anon.rpc(fn);
      expect(r.error, `${fn} must not be callable by anon`).not.toBeNull();
    }
    const user = await createAuthedTestUser("sup-fn");
    try {
      for (const fn of ["job_supersession_plan", "apply_job_supersession"] as const) {
        expect((await user.client.rpc(fn)).error, `${fn} must not be callable by authenticated`).not.toBeNull();
      }
    } finally {
      await deleteTestUsers([user.id]);
    }
  });
});
