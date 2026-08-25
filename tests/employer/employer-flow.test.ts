/**
 * The employer surface, exercised end to end against the real policies.
 *
 * WHY THIS SUITE IS THE POINT, not a formality: migrations 0026, 0027 and 0028
 * all fixed real holes in `organizations` / `organization_members` /
 * `job_postings`, and all three existed for the same reason — no product code
 * had ever used those tables, so the policies were never run. This is that
 * code. If these policies are wrong again, this is where it shows.
 *
 * 0028 was found by this build: before it, an org member could set
 * `verified = true` on their own organisation in one call, which made 0027's
 * feed gate decorative. That case is `an org cannot verify itself` below.
 *
 * Two users, both real authenticated sessions (never the service role, which
 * bypasses RLS and would prove nothing):
 *   A — creates an organisation, owns it, posts a job
 *   B — unrelated; must not be able to see, join, post to, or escalate into it
 *
 * Positive controls throughout, because every negative result here would also
 * be produced by a system that simply refuses everyone — which is precisely
 * what the recursion bug in 0026 looked like before it was diagnosed.
 *
 * Environment note, same as the other RLS suites: this runs against the real
 * project. It creates namespaced throwaway users and orgs and deletes them in
 * afterAll, and only ever touches rows it created.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) {
    throw new Error(`Employer flow test cannot run: ${key} is not set.`);
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createAuthedUser(label: string): Promise<{ id: string; client: DB }> {
  const email = `employer-${label}-${randomUUID()}@talentrah.test`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw error;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;
  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: otpErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
  return { id: created.user!.id, client };
}

let employerA: Awaited<ReturnType<typeof createAuthedUser>>;
let outsiderB: Awaited<ReturnType<typeof createAuthedUser>>;
let orgId: string;
let jobId: string;
const jobFingerprint = `employer-test-${randomUUID()}`;
const orgName = `EMPLOYER-TEST-Org-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  [employerA, outsiderB] = await Promise.all([
    createAuthedUser("owner"),
    createAuthedUser("outsider"),
  ]);

  // --- The real onboarding path, through A's OWN client, exactly as
  // createOrganizationAction does it. Not seeded with the service role: the
  // point is that the RLS policies permit the legitimate flow.
  const { data: org, error: orgError } = await employerA.client
    .from("organizations")
    .insert({ name: orgName, domain: "employer-test.example", created_by: employerA.id })
    .select("id, verified")
    .single();
  if (orgError) throw new Error(`A could not create an organisation: ${orgError.message}`);
  orgId = org!.id;

  const { error: joinError } = await employerA.client
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: employerA.id, role: "owner" });
  if (joinError) throw new Error(`A could not join their own org: ${joinError.message}`);

  const { data: job, error: jobError } = await employerA.client
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: orgName,
      title: "EMPLOYER-TEST Backend Engineer",
      location: "Lagos, Nigeria",
      description: "A real description, long enough to pass the form's own minimum length check.",
      status: "open",
      dedup_fingerprint: jobFingerprint,
    })
    .select("id")
    .single();
  if (jobError) throw new Error(`A could not post a job to their own org: ${jobError.message}`);
  jobId = job!.id;
});

afterAll(async () => {
  await admin.from("job_postings").delete().eq("dedup_fingerprint", jobFingerprint);
  await admin.from("job_postings").delete().like("title", "EMPLOYER-TEST%");
  for (const u of [employerA, outsiderB]) {
    if (!u) continue;
    await admin.from("organization_members").delete().eq("user_id", u.id);
  }
  if (orgId) await admin.from("organizations").delete().eq("id", orgId);
  await admin.from("organizations").delete().like("name", "EMPLOYER-TEST%");
  for (const u of [employerA, outsiderB]) {
    if (u) await admin.auth.admin.deleteUser(u.id);
  }
});

describe("employer: the legitimate path works", () => {
  it("a new organisation starts unverified", async () => {
    const { data } = await admin.from("organizations").select("verified").eq("id", orgId).single();
    expect(data?.verified, "self-created orgs must not start out trusted").toBe(false);
  });

  it("the owner can read their own membership row", async () => {
    const { data, error } = await employerA.client
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", orgId);
    expect(error?.message ?? "", "membership reads must evaluate, not recurse").not.toMatch(
      /infinite recursion/i,
    );
    expect(data ?? []).toHaveLength(1);
    expect(data?.[0]?.role).toBe("owner");
  });

  it("the owner sees their own posting even while the org is unverified", async () => {
    // The other half of 0027's gate. Without this the "not visible" results
    // below would be satisfied by a posting nobody can see at all — including
    // the employer who wrote it, which would be a broken product, not a gate.
    const { data } = await employerA.client.from("job_postings").select("id").eq("id", jobId);
    expect(data ?? [], "an employer must be able to see their own draft posting").toHaveLength(1);
  });

  it("the owner can edit and close their own posting", async () => {
    await employerA.client
      .from("job_postings")
      .update({ title: "EMPLOYER-TEST Backend Engineer (updated)" })
      .eq("id", jobId)
      .eq("organization_id", orgId);
    const { data: edited } = await admin.from("job_postings").select("title").eq("id", jobId).single();
    expect(edited?.title).toContain("(updated)");

    await employerA.client.from("job_postings").update({ status: "closed" }).eq("id", jobId);
    const { data: closed } = await admin.from("job_postings").select("status").eq("id", jobId).single();
    expect(closed?.status).toBe("closed");

    await employerA.client.from("job_postings").update({ status: "open" }).eq("id", jobId);
  });

  it("the owner can edit the company profile", async () => {
    const { error } = await employerA.client
      .from("organizations")
      .update({ description: "EMPLOYER-TEST description" })
      .eq("id", orgId);
    expect(error, "0028 must not have locked employers out of their own profile").toBeNull();
    const { data } = await admin.from("organizations").select("description").eq("id", orgId).single();
    expect(data?.description).toBe("EMPLOYER-TEST description");
  });
});

describe("employer: the 0027 verification gate, against this code path", () => {
  it("an unverified org's posting is invisible to an unrelated user", async () => {
    const { data } = await outsiderB.client
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .eq("dedup_fingerprint", jobFingerprint);
    expect(
      data ?? [],
      "LEAK: an unverified company's job reached another user's feed",
    ).toHaveLength(0);
  });

  it("an org cannot verify itself — the gate is not self-service", async () => {
    // The hole this build found. Before migration 0028 this call succeeded and
    // the next assertion would have shown the posting going public, making
    // 0027 a formality any employer could step over.
    const { error } = await employerA.client
      .from("organizations")
      .update({ verified: true })
      .eq("id", orgId);

    const { data } = await admin.from("organizations").select("verified").eq("id", orgId).single();
    expect(
      data?.verified,
      "ESCALATION: an organisation marked itself verified and can now publish to the public feed",
    ).toBe(false);
    expect(error, "the write should be refused outright, not silently dropped").not.toBeNull();
  });

  it("once verified server-side, the same posting does reach the feed", async () => {
    // Positive control for the gate itself. A gate that never opens is not a
    // gate, and every "not visible" assertion above would pass under one.
    // Verification here goes through the service role, which is the only way
    // it can happen in the product too (src/lib/employer/actions.ts).
    await admin.from("organizations").update({ verified: true }).eq("id", orgId);

    const { data } = await outsiderB.client
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .eq("dedup_fingerprint", jobFingerprint);
    expect(data ?? [], "a verified company's job should be publicly visible").toHaveLength(1);

    await admin.from("organizations").update({ verified: false }).eq("id", orgId);
  });
});

describe("employer: an outsider cannot get in", () => {
  it("B cannot join A's organisation", async () => {
    await outsiderB.client
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: outsiderB.id, role: "owner" });

    const { data } = await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", orgId)
      .eq("user_id", outsiderB.id);
    expect(
      data ?? [],
      "ESCALATION: an unrelated user made themselves a member of someone else's company",
    ).toHaveLength(0);
  });

  it("B cannot escalate a role they do not have", async () => {
    // Distinct from the insert case: this is the "already in the door" shape,
    // and it must fail even though B is passing their own user_id.
    await outsiderB.client
      .from("organization_members")
      .update({ role: "owner" })
      .eq("organization_id", orgId)
      .eq("user_id", employerA.id);

    const { data } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", employerA.id)
      .single();
    expect(data?.role, "an outsider rewrote a membership row").toBe("owner");

    const { data: mine } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("user_id", outsiderB.id);
    expect(mine ?? [], "an outsider ended up with a membership somewhere").toHaveLength(0);
  });

  it("B cannot see A's membership rows", async () => {
    const { data, error } = await outsiderB.client
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId);
    expect(error?.message ?? "").not.toMatch(/infinite recursion/i);
    expect(data ?? [], "LEAK: an outsider read another company's member list").toHaveLength(0);
  });

  it("B cannot post a job under A's organisation", async () => {
    const strayFingerprint = `employer-test-stray-${randomUUID()}`;
    await outsiderB.client.from("job_postings").insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: orgName,
      title: "EMPLOYER-TEST Stray Posting",
      description: "Should never exist under someone else's company.",
      status: "open",
      dedup_fingerprint: strayFingerprint,
    });

    const { data } = await admin
      .from("job_postings")
      .select("id")
      .eq("dedup_fingerprint", strayFingerprint);
    expect(
      data ?? [],
      "LEAK: an outsider published a job under a company they have nothing to do with",
    ).toHaveLength(0);
  });

  it("B cannot edit A's posting", async () => {
    await outsiderB.client
      .from("job_postings")
      .update({ title: "EMPLOYER-TEST hijacked" })
      .eq("id", jobId);

    const { data } = await admin.from("job_postings").select("title").eq("id", jobId).single();
    expect(data?.title, "an outsider rewrote another company's job posting").not.toContain(
      "hijacked",
    );
  });

  it("B cannot edit A's company profile", async () => {
    await outsiderB.client
      .from("organizations")
      .update({ description: "EMPLOYER-TEST hijacked" })
      .eq("id", orgId);

    const { data } = await admin.from("organizations").select("description").eq("id", orgId).single();
    expect(data?.description).not.toContain("hijacked");
  });
});

describe("employer: application counts (migration 0029)", () => {
  it("a member gets counts for their own organisation", async () => {
    // Seeded with the service role because `applications` is owner-only and an
    // employer legitimately cannot write one — which is the whole reason the
    // count needs a definer function rather than a join.
    const seeker = await createAuthedUser("seeker");
    try {
      await admin.from("applications").insert({
        user_id: seeker.id,
        job_posting_id: jobId,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
      });

      const { data, error } = await employerA.client.rpc("org_application_counts", {
        p_organization_id: orgId,
      });
      expect(error).toBeNull();
      const row = (data ?? []).find((r) => r.job_posting_id === jobId);
      expect(row?.application_count, "the employer should see one application").toBe(1);

      // The count must not come with the applicant attached.
      expect(Object.keys(row ?? {}).sort()).toEqual(["application_count", "job_posting_id"]);

      // And the underlying rows stay invisible: the count is aggregate-only.
      const { data: rawRows } = await employerA.client
        .from("applications")
        .select("id, user_id")
        .eq("job_posting_id", jobId);
      expect(rawRows ?? [], "LEAK: an employer read the applicant's own row").toHaveLength(0);
    } finally {
      await admin.from("applications").delete().eq("user_id", seeker.id);
      await admin.auth.admin.deleteUser(seeker.id);
    }
  });

  it("an outsider gets nothing for an organisation they are not in", async () => {
    const { data, error } = await outsiderB.client.rpc("org_application_counts", {
      p_organization_id: orgId,
    });
    expect(error).toBeNull();
    expect(
      data ?? [],
      "LEAK: a non-member learned how many people applied to another company's jobs",
    ).toHaveLength(0);
  });
});
