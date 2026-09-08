/**
 * `0113` closed two INSERT-side holes, both found while building the CAC
 * verification (draft `0114`) and Path 3 (draft `0116`) branches, both
 * exploitable independent of either feature:
 *
 *   1. `organizations`' INSERT policy only ever checked `created_by =
 *      auth.uid()`. `0028` locked `verified` against UPDATE but never
 *      touched INSERT, so a client could self-verify by naming `verified:
 *      true` on the row's own creation instead of a later update.
 *   2. `job_postings`' "org members can manage their org's internal
 *      postings" INSERT policy never constrained `unlisted_at`/`removed_at`/
 *      `removal_reason`/`removed_by` either — an org member could insert
 *      their own new posting pre-stamped with a self-fabricated moderation
 *      record.
 *
 * Neither hole had a test before this file — confirmed by grep before
 * writing it. This is a real-database suite, matching this repo's own
 * convention for RLS policy behaviour (`tests/rls/path3-job-review.test.ts`,
 * `tests/rls/column-privileges.test.ts`): what a policy actually permits is
 * proven against Postgres, not read off the migration file's text.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

let user: TestUser & { client: DB };
let ownOrgId: string;
const smuggledOrgIds: string[] = [];
const smuggledJobIds: string[] = [];

beforeAll(async () => {
  user = await createAuthedTestUser("insert-hardening");

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ name: `INSERTHARDEN-TEST Org ${randomUUID().slice(0, 8)}`, created_by: user.id, verified: false })
    .select("id")
    .single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  ownOrgId = org.id;

  // Real ownership, the same way every other RLS suite in this repo
  // establishes it — the row above already carries created_by, so a plain
  // membership row (0026's own model) is what makes is_org_member true for
  // this user.
  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: ownOrgId, user_id: user.id, role: "owner" });
  if (memberErr) throw new Error(`fixture membership: ${memberErr.message}`);
});

afterAll(async () => {
  if (smuggledJobIds.length) await admin.from("job_postings").delete().in("id", smuggledJobIds);
  if (smuggledOrgIds.length) await deleteTestOrgs(smuggledOrgIds);
  if (ownOrgId) await deleteTestOrgs([ownOrgId]);
  await deleteTestUsers([user.id]);
});

describe("SABOTAGE-PROOF TARGET: organizations INSERT can no longer smuggle verified = true", () => {
  it("rejects an insert that names verified: true on the row's own creation", async () => {
    const { data, error } = await user.client
      .from("organizations")
      .insert({
        name: `INSERTHARDEN-TEST Smuggled ${randomUUID().slice(0, 8)}`,
        created_by: user.id,
        verified: true,
      })
      .select("id")
      .single();

    if (data) smuggledOrgIds.push(data.id); // clean up even if the assertion below is about to fail
    expect(error, "a client-supplied verified: true on INSERT must be rejected by RLS").toBeTruthy();
    expect(error?.code).toBe("42501");
  });

  it("still allows the normal, unprivileged path — verified defaults to false and is never named", async () => {
    const { data, error } = await user.client
      .from("organizations")
      .insert({ name: `INSERTHARDEN-TEST Normal ${randomUUID().slice(0, 8)}`, created_by: user.id })
      .select("id, verified")
      .single();
    if (data) smuggledOrgIds.push(data.id);

    expect(error, "a real, unprivileged signup insert must not be affected by this hardening").toBeNull();
    expect(data?.verified).toBe(false);
  });
});

describe("SABOTAGE-PROOF TARGET: job_postings INSERT can no longer smuggle a self-fabricated moderation record", () => {
  it("rejects an insert naming removed_at/removal_reason/removed_by on the row's own creation", async () => {
    const { data, error } = await user.client
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: ownOrgId,
        company_name: "INSERTHARDEN-TEST Co",
        title: `INSERTHARDEN-TEST Smuggled Removed ${randomUUID().slice(0, 8)}`,
        description: "Fixture — should be rejected.",
        structured_jd: {},
        status: "open",
        dedup_fingerprint: `insertharden-removed-${randomUUID()}`,
        removed_at: new Date().toISOString(),
        removal_reason: "self-smuggled",
        removed_by: user.id,
      })
      .select("id")
      .single();

    if (data) smuggledJobIds.push(data.id);
    expect(error, "a client-supplied removed_at/removal_reason/removed_by on INSERT must be rejected").toBeTruthy();
    expect(error?.code).toBe("42501");
  });

  it("rejects an insert naming unlisted_at on the row's own creation", async () => {
    const { data, error } = await user.client
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: ownOrgId,
        company_name: "INSERTHARDEN-TEST Co",
        title: `INSERTHARDEN-TEST Smuggled Unlisted ${randomUUID().slice(0, 8)}`,
        description: "Fixture — should be rejected.",
        structured_jd: {},
        status: "open",
        dedup_fingerprint: `insertharden-unlisted-${randomUUID()}`,
        unlisted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (data) smuggledJobIds.push(data.id);
    expect(error, "a client-supplied unlisted_at on INSERT must be rejected").toBeTruthy();
    expect(error?.code).toBe("42501");
  });

  it("still allows the normal path — a real posting with none of the trust columns set", async () => {
    const { data, error } = await user.client
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: ownOrgId,
        company_name: "INSERTHARDEN-TEST Co",
        title: `INSERTHARDEN-TEST Normal ${randomUUID().slice(0, 8)}`,
        description: "Fixture — a normal posting creation.",
        structured_jd: {},
        status: "open",
        dedup_fingerprint: `insertharden-normal-${randomUUID()}`,
      })
      .select("id, unlisted_at, removed_at, removal_reason, removed_by")
      .single();
    if (data) smuggledJobIds.push(data.id);

    expect(error, "a real, unprivileged posting creation must not be affected by this hardening").toBeNull();
    expect(data?.unlisted_at).toBeNull();
    expect(data?.removed_at).toBeNull();
    expect(data?.removal_reason).toBeNull();
    expect(data?.removed_by).toBeNull();
  });
});
