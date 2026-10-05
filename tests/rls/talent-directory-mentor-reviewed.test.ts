/**
 * VERIFY-1 Phase 0a: a mentor-reviewed candidate (verified, with a NULL score) is listed under exactly the same rules as an AI-reviewed one. The directory used to
 * hide them in the page because they have no score; the page now shows them with a "Resume reviewed by a Talentrah mentor" badge, so this proves the database
 * side: who is listed is decided by opt-in, the status, and an active account (no pending deletion), and by nothing about who reviewed the resume.
 *
 * The rule: talent_directory_listed_ids() (0206:59–70: opted in AND status 'verified'), patched by 0212:587–591 to add `deletion_requested_at is null`. The paid search
 * reads it for every caller, so the checks below go through the search itself (an employer with an active subscription looks each candidate up by id) as well as
 * the shared helper.
 *
 * AUTHENTICATED-SESSION TEST (a minted employer session), so it runs in CI, like tests/rls/talent-directory-preview.test.ts which it mirrors. The same rule was also
 * run against a real Postgres built from every repo migration on the author's machine (6 candidate states, all as expected).
 *
 * VERIFY-1 0a-2 (0234): both employer reads now say WHEN and BY WHOM, derived once in SQL (a verified profile with no stored score is a mentor review, one with a
 * score is Farah's). The last two describe blocks pin that: the search's review_type, and the applicant list's review date and type, including that the applicant
 * list is still not gated on opt-in and still hides a person who asked to delete their account.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Mentor-reviewed listing suite cannot run: ${key} is not set.`);
}

interface State {
  label: string;
  reviewer: "ai" | "mentor";
  optIn: boolean;
  deleting: boolean;
  listed: boolean;
}
const STATES: State[] = [
  { label: "AI-reviewed, opted in", reviewer: "ai", optIn: true, deleting: false, listed: true },
  { label: "mentor-reviewed, opted in", reviewer: "mentor", optIn: true, deleting: false, listed: true },
  { label: "AI-reviewed, NOT opted in", reviewer: "ai", optIn: false, deleting: false, listed: false },
  { label: "mentor-reviewed, NOT opted in", reviewer: "mentor", optIn: false, deleting: false, listed: false },
  { label: "AI-reviewed, opted in, deletion requested", reviewer: "ai", optIn: true, deleting: true, listed: false },
  { label: "mentor-reviewed, opted in, deletion requested", reviewer: "mentor", optIn: true, deleting: true, listed: false },
];

let candidates: Array<State & { id: string }> = [];
let owner: { id: string; client: DB };
let unreviewed: { id: string };
let postingId = "";
const orgIds: string[] = [];

beforeAll(async () => {
  owner = await createAuthedTestUser("tdment-owner");
  const made = await Promise.all(STATES.map((s) => createAuthedTestUser(`tdment-${s.label.replace(/\W+/g, "-")}`)));
  candidates = made.map((m, i) => ({ ...STATES[i], id: m.id }));
  await Promise.all(
    candidates.map((c) =>
      admin
        .from("profiles")
        .update({
          talent_directory_opt_in: c.optIn,
          talent_verification_status: "verified",
          talent_verification_score: c.reviewer === "ai" ? 87 : null,
          talent_verified_at: "2026-10-05T09:30:00Z",
          deletion_requested_at: c.deleting ? new Date().toISOString() : null,
        })
        .eq("id", c.id),
    ),
  );
  const { data: org } = await admin.from("organizations").insert({ name: `TDMent Org ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true }).select("id").single();
  orgIds.push(org!.id);
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: owner.id, role: "owner" });
  const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
  await admin.from("talent_directory_subscriptions").insert({ organization_id: org!.id, plan_id: plan!.id, expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(), status: "active" });

  // one job posting that every candidate (and one person with no review) has applied to, for the applicant-list checks
  unreviewed = await createAuthedTestUser("tdment-unreviewed");
  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: org!.id,
      company_name: "TDMent Co",
      title: `TDMent Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the mentor-reviewed suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`fixture posting: ${jobErr?.message}`);
  postingId = job.id;
  const { error: appErr } = await admin
    .from("applications")
    .insert([...candidates.map((c) => c.id), unreviewed.id].map((user_id) => ({ user_id, job_posting_id: postingId, applied_at: new Date().toISOString() })));
  if (appErr) throw new Error(`fixture applications: ${appErr.message}`);
}, 120_000);

afterAll(async () => {
  if (orgIds[0]) await admin.from("talent_directory_subscriptions").delete().eq("organization_id", orgIds[0]);
  await deleteTestOrgs(orgIds);
  await deleteTestUsers([...candidates.map((c) => c.id), owner?.id, unreviewed?.id].filter(Boolean));
}, 60_000);

describe("who is listed does not depend on who reviewed the resume", () => {
  it.each(STATES.map((s) => [s.label, s] as const))("%s", async (label, state) => {
    const c = candidates.find((x) => x.label === label)!;
    const { data: ids } = await admin.rpc("talent_directory_listed_ids");
    expect(((ids ?? []) as unknown as string[]).includes(c.id), "the shared gate").toBe(state.listed);

    const { data, error } = await owner.client.rpc("talent_directory_search", { p_candidate_id: c.id });
    expect(error, error?.message).toBeNull();
    expect((data ?? []).length === 1, "the paid search, looked up by id").toBe(state.listed);
  });

  it("a mentor-reviewed candidate comes back from the search with no score and the date of the review, which is what the page turns into the mentor badge", async () => {
    const mentor = candidates.find((c) => c.label === "mentor-reviewed, opted in")!;
    const { data } = await owner.client.rpc("talent_directory_search", { p_candidate_id: mentor.id });
    expect(data).toHaveLength(1);
    expect(data![0].verification_score).toBeNull();
    expect(new Date(data![0].verified_at as string).toISOString()).toBe("2026-10-05T09:30:00.000Z");
  });

  it("the search says who reviewed each listed candidate (0234): 'ai' where a score is stored, 'mentor' where none is", async () => {
    const ai = candidates.find((c) => c.label === "AI-reviewed, opted in")!;
    const mentor = candidates.find((c) => c.label === "mentor-reviewed, opted in")!;
    const { data: a } = await owner.client.rpc("talent_directory_search", { p_candidate_id: ai.id });
    const { data: m } = await owner.client.rpc("talent_directory_search", { p_candidate_id: mentor.id });
    expect(a?.[0]?.review_type).toBe("ai");
    expect(m?.[0]?.review_type).toBe("mentor");
  });

  it("a mentor-reviewed candidate who has not opted in does not appear in an unfiltered search either", async () => {
    const hidden = candidates.find((c) => c.label === "mentor-reviewed, NOT opted in")!;
    const { data } = await owner.client.rpc("talent_directory_search", { p_limit: 50 });
    expect((data ?? []).map((r: { user_id: string }) => r.user_id)).not.toContain(hidden.id);
  });
});

describe("the employer applicant list says when and by whom a resume was reviewed (0234)", () => {
  type Row = { application_id: string; talent_verification_status: string; talent_verified_at: string | null; talent_review_type: string | null; first_name: string };
  const load = async (): Promise<Row[]> => {
    const { data, error } = await owner.client.rpc("employer_job_applicants", { p_job_posting_id: postingId });
    expect(error, error?.message).toBeNull();
    return (data ?? []) as unknown as Row[];
  };
  const byLabel = (rows: Row[], id: string, applications: Map<string, string>) => rows.find((r) => r.application_id === applications.get(id));

  it("an AI review and a mentor review each come back with the review date and their own type; opt-in does not matter here", async () => {
    const { data: apps } = await admin.from("applications").select("id, user_id").eq("job_posting_id", postingId);
    const appOf = new Map((apps ?? []).map((a) => [a.user_id as string, a.id as string]));
    const rows = await load();
    for (const label of ["AI-reviewed, opted in", "AI-reviewed, NOT opted in"]) {
      const c = candidates.find((x) => x.label === label)!;
      const r = byLabel(rows, c.id, appOf)!;
      expect(r.talent_review_type, label).toBe("ai");
      expect(new Date(r.talent_verified_at as string).toISOString(), label).toBe("2026-10-05T09:30:00.000Z");
    }
    for (const label of ["mentor-reviewed, opted in", "mentor-reviewed, NOT opted in"]) {
      const c = candidates.find((x) => x.label === label)!;
      const r = byLabel(rows, c.id, appOf)!;
      expect(r.talent_review_type, label).toBe("mentor");
      expect(new Date(r.talent_verified_at as string).toISOString(), label).toBe("2026-10-05T09:30:00.000Z");
    }
  });

  it("someone whose resume has no passed review has no type and no date", async () => {
    const { data: apps } = await admin.from("applications").select("id, user_id").eq("job_posting_id", postingId);
    const appOf = new Map((apps ?? []).map((a) => [a.user_id as string, a.id as string]));
    const r = byLabel(await load(), unreviewed.id, appOf)!;
    expect(r.talent_review_type).toBeNull();
    expect(r.talent_verified_at).toBeNull();
  });

  it("a person with a stored date who is NOT verified (a rejected review) shows no date and no type", async () => {
    await admin.from("profiles").update({ talent_verification_status: "rejected", talent_verification_score: 40, talent_verified_at: "2026-10-06T09:30:00Z" }).eq("id", unreviewed.id);
    const { data: apps } = await admin.from("applications").select("id, user_id").eq("job_posting_id", postingId);
    const appOf = new Map((apps ?? []).map((a) => [a.user_id as string, a.id as string]));
    const r = byLabel(await load(), unreviewed.id, appOf)!;
    expect(r.talent_review_type).toBeNull();
    expect(r.talent_verified_at).toBeNull();
  });

  it("a person who asked to delete their account is still not listed", async () => {
    const { data: apps } = await admin.from("applications").select("id, user_id").eq("job_posting_id", postingId);
    const appOf = new Map((apps ?? []).map((a) => [a.user_id as string, a.id as string]));
    const rows = await load();
    for (const label of ["AI-reviewed, opted in, deletion requested", "mentor-reviewed, opted in, deletion requested"]) {
      const c = candidates.find((x) => x.label === label)!;
      expect(byLabel(rows, c.id, appOf), label).toBeUndefined();
    }
  });
});
