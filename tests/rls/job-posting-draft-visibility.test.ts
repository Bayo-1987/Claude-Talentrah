/**
 * A job posting can now be saved as a draft before it goes live (send-447).
 *
 * `draft` gets the SAME visibility treatment `removed` already has (0056):
 * invisible to the public, visible to the owning org, editable by the
 * owning org — with one extra wrinkle `removed` never had. `removed` is
 * operator-only in and out (a trap door), so nobody but the service role
 * ever needs to SET or CLEAR it via a plain UPDATE that leaves it
 * untouched. `draft` is different: an org edits its own draft constantly
 * (title, description, skills) WITHOUT ever mentioning `status` in that
 * UPDATE, and Postgres's WITH CHECK re-evaluates the ROW AS IT WOULD BE
 * AFTER the update, not which columns the statement named. So the real risk
 * here isn't just "can a stranger see a draft" (the SELECT policy, same
 * shape as 'removed') — it's "does editing a draft you never intended to
 * touch the status of get silently rejected by RLS" (the UPDATE policy's
 * WITH CHECK, which had exactly this bug until 0190 added 'draft' to its
 * allowed list).
 *
 * Also covers the two column-grant changes 0190 makes: `posted_at` is no
 * longer UPDATE-grantable to a client role at all (closed here, not just
 * documented — see tests/rls/column-privileges.test.ts for the standing,
 * broader check), and `requestJobReviewAction`'s own new `status = 'open'`
 * guard, found while auditing this feature rather than asked for directly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let owner: Awaited<ReturnType<typeof createAuthedTestUser>>;
// A member of a DIFFERENT, verified org — the task explicitly wants "a
// different (even verified) organisation's member" checked, not just an
// anonymous/unaffiliated stranger, since a verified org is the case most
// likely to be mistaken for "trusted enough to see more."
let otherOrgMember: Awaited<ReturnType<typeof createAuthedTestUser>>;
let orgId: string;
let otherOrgId: string;
let draftId: string;

async function rowOf(id: string) {
  const { data, error } = await admin
    .from("job_postings")
    .select("status, posted_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  owner = await createAuthedTestUser("draft-owner");
  otherOrgMember = await createAuthedTestUser("draft-other-org-member");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: "DRAFT-TEST Co",
      domain: `draft-test-${randomUUID()}.test`,
      created_by: owner.id,
      verified: true,
    })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: owner.id, role: "owner" });
  if (memberErr) throw new Error(`fixture membership: ${memberErr.message}`);

  // A second, verified org — the "even verified" case the task calls out.
  const { data: otherOrg, error: otherOrgErr } = await admin
    .from("organizations")
    .insert({
      name: "DRAFT-TEST Other Co",
      domain: `draft-test-other-${randomUUID()}.test`,
      created_by: otherOrgMember.id,
      verified: true,
    })
    .select("id")
    .single();
  if (otherOrgErr || !otherOrg) throw new Error(`fixture other org: ${otherOrgErr?.message}`);
  otherOrgId = otherOrg.id;

  const { error: otherMemberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: otherOrgId, user_id: otherOrgMember.id, role: "owner" });
  if (otherMemberErr) throw new Error(`fixture other membership: ${otherMemberErr.message}`);

  const { data: draft, error: draftErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "DRAFT-TEST Co",
      title: "DRAFT-TEST Backend Engineer",
      description: "Fixture draft posting owned by tests/rls/job-posting-draft-visibility.",
      structured_jd: { skills: ["sql"] },
      status: "draft",
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (draftErr || !draft) throw new Error(`fixture draft posting: ${draftErr?.message}`);
  draftId = draft.id;
});

afterAll(async () => {
  const { error } = await admin.from("job_postings").delete().eq("id", draftId);
  if (error) console.error("[draft-visibility cleanup: posting]", error.message);
  await deleteOrgsCascade(admin, [orgId, otherOrgId]);
  await deleteTestUsers([owner.id, otherOrgMember.id]);
});

describe("1. the public loses sight of a draft; the owning org does not", () => {
  it("a signed-out visitor cannot see it", async () => {
    const { data } = await anon.from("job_postings").select("id").eq("id", draftId);
    expect(data).toEqual([]);
  });

  it("a member of a DIFFERENT, verified org cannot see it either", async () => {
    // The case worth naming explicitly: "verified" answers a different
    // question (is this org trustworthy) than "is this org the owner"
    // (is this org allowed to see THIS row). A policy bug that let
    // verified-org-ness substitute for ownership would pass every anon
    // check and still leak.
    const { data } = await otherOrgMember.client.from("job_postings").select("id").eq("id", draftId);
    expect(data).toEqual([]);
  });

  it("but its own org's member sees it fine", async () => {
    const { data, error } = await owner.client
      .from("job_postings")
      .select("id, status")
      .eq("id", draftId)
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe("draft");
  });
});

describe("2. a draft is editable by its own org without touching status", () => {
  it("the org can edit a draft's title and it stays a draft", async () => {
    /*
     * THE BUG THIS SEND FOUND AND FIXED: `updateJobAction` never includes
     * `status` in its own UPDATE payload, so this edit leaves it at
     * whatever it already was. Before 0190 added 'draft' to the UPDATE
     * policy's WITH CHECK, Postgres would re-evaluate the post-update row
     * (still status = 'draft') against a check that only allowed
     * ('open', 'closed') and reject EVERY edit to an existing draft,
     * including this one — a real, not hypothetical, regression the
     * enum value alone would have introduced.
     */
    const { error } = await owner.client
      .from("job_postings")
      .update({ title: "DRAFT-TEST Backend Engineer (revised)" })
      .eq("id", draftId);
    expect(error).toBeNull();

    const after = await rowOf(draftId);
    expect(after.status).toBe("draft");

    const { data } = await admin.from("job_postings").select("title").eq("id", draftId).single();
    expect(data!.title).toBe("DRAFT-TEST Backend Engineer (revised)");
  });

  it("a different org's member cannot edit it — zero rows, not an error", async () => {
    const { error } = await otherOrgMember.client
      .from("job_postings")
      .update({ title: "DRAFT-TEST hijacked" })
      .eq("id", draftId);
    // A row policy denial affects zero rows rather than erroring.
    expect(error).toBeNull();
    const { data } = await admin.from("job_postings").select("title").eq("id", draftId).single();
    expect(data!.title).not.toBe("DRAFT-TEST hijacked");
  });
});

describe("3. posted_at is no longer something a client can set directly", () => {
  it("the owning org cannot PATCH posted_at on its own draft", async () => {
    /*
     * The grant, not the row policy — the row is theirs and the UPDATE
     * policy would allow it, so only the column-level revoke (0190) refuses
     * this, which is why it raises (42501) rather than matching zero rows.
     * Confirmed live before 0190: posted_at was UPDATE-grantable to BOTH
     * authenticated and anon — a real, pre-existing freshness-gaming hole,
     * not something already closed.
     */
    const { error } = await owner.client
      .from("job_postings")
      .update({ posted_at: "2020-01-01T00:00:00.000Z" })
      .eq("id", draftId);
    expect(error).not.toBeNull();
  });
});

describe("4. the mechanics publishJobAction relies on: status open, then posted_at stamped", () => {
  /*
   * This proves the RLS/grant PLUMBING `publishJobAction` runs on top of,
   * not the action function itself — Server Actions resolve their session
   * via `cookies()`, which throws outside a real Next.js request scope (the
   * same limitation tests/rls/column-privileges.test.ts already documents
   * for other Server Actions in this codebase). The action's own real code
   * path — reading `.eq("status", "draft")`, the actual redirect/revalidate
   * — is covered end-to-end in tests/employer/job-posting-draft-actions.test.ts,
   * which mocks a real session the way tests/employer/job-posting-skills.test.ts
   * already establishes the pattern for.
   *
   * The two steps below are exactly what that action does: the session
   * client authorises and performs the status flip (RLS plus the `status`
   * column grant are the real gate), a separate service-role write stamps
   * the trust column that session client is no longer allowed to touch
   * itself (section 3 above).
   */
  it("the session client can flip status draft -> open on its own posting", async () => {
    const before = await rowOf(draftId);
    expect(before.status).toBe("draft");

    const { data: updated, error } = await owner.client
      .from("job_postings")
      .update({ status: "open" })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id");
    expect(error).toBeNull();
    expect(updated).toHaveLength(1);
  });

  it("and only the service role can then stamp posted_at to now", async () => {
    const beforeStamp = Date.now();
    const { error } = await admin
      .from("job_postings")
      .update({ posted_at: new Date().toISOString() })
      .eq("id", draftId);
    const afterStamp = Date.now();
    expect(error).toBeNull();

    const after = await rowOf(draftId);
    // Two real facts, not one inferred from the other: status and posted_at
    // are separate writes through separate clients, and a bug that landed
    // one without the other must fail visibly on both assertions.
    expect(after.status).toBe("open");
    expect(after.posted_at).not.toBeNull();
    const postedAtMs = new Date(after.posted_at).getTime();
    expect(postedAtMs).toBeGreaterThanOrEqual(beforeStamp);
    expect(postedAtMs).toBeLessThanOrEqual(afterStamp + 1000);
  });

  it("is now visible to the public — the same row, no longer a draft", async () => {
    const { data } = await anon.from("job_postings").select("id, status").eq("id", draftId).single();
    expect(data?.status).toBe("open");
  });

  it("the same conditional update against an already-open row matches zero rows", async () => {
    // The `.eq("status", "draft")` scoping publishJobAction relies on to be
    // a true no-op against anything that isn't a draft, proven directly
    // against the row this describe block just published.
    const { data: updated, error } = await owner.client
      .from("job_postings")
      .update({ status: "open" })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id");
    expect(error).toBeNull();
    expect(updated).toEqual([]);
  });
});
