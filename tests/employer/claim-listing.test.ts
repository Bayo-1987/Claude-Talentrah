/**
 * "Claim your listing" (0128/0129, build-prompt §6.12) — a real employer
 * takes ownership of an aggregated posting.
 *
 * What this suite proves against a real database, not just reads off the
 * migration:
 *
 *   1. `job_posting_claim_candidates` finds a domain-hostname match
 *      (confidence "domain") and a normalised company-name match
 *      (confidence "name"), and excludes a posting that matches neither.
 *   2. `claim_external_job_posting` re-verifies the match server-side — a
 *      caller cannot claim a posting that doesn't actually match their
 *      organisation just by naming its id, even though the candidate list
 *      only ever suggests.
 *   3. Claiming is atomic and idempotent-against-races: it creates exactly
 *      one new internal posting, marks the external row removed+claimed,
 *      and a second claim attempt on the same external row is refused.
 *   4. An existing `applications` row pointing at the external id is
 *      NEVER mutated by a claim — the seeker's own tracker record of what
 *      they applied to stays exactly as it was.
 *   5. `job_postings_internal_has_org` still holds: a direct attempt to
 *      violate it (an internal row with no org, or an external row with
 *      one) is refused by Postgres, not by application code.
 *   6. The two new trust columns are not writable by a client role, either
 *      via UPDATE or smuggled into a fresh INSERT — the same 0114/0119
 *      hardening this migration extends.
 *   7. The claimed row's fate: `status = 'removed'`, excluded from the
 *      public feed's own predicate, and its claim marker is cleared again
 *      if an admin ever restores it (the trigger fix in 0129).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB, type TestUser } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const tag = randomUUID().slice(0, 8);
/* Letter-initial nonce — a uuid slice can be all digits, and this repo's own
 * CLAUDE.md records that as a real way for a search-shaped assertion to pass
 * for the wrong reason. */
const NONCE = `zqc${tag}`;

let claimingOwner: TestUser & { client: DB };
let strangerUser: TestUser & { client: DB };
let claimingOrgId = "";
let unverifiedOrgId = "";
let unrelatedOrgId = "";

let domainMatchJobId = "";
let nameMatchJobId = "";
let noMatchJobId = "";
let alreadyClaimedJobId = "";
let unverifiedOrgMatchJobId = "";
let restoreFixtureJobId = "";
let staysRemovedFixtureJobId = "";

let seekerApplicationId = "";
let seekerUserId = "";

const CLAIM_DOMAIN = `claim-${tag}.example`;
const CLAIM_ORG_NAME = `CLAIM-TEST Co ${NONCE}`;
/* Same name, different case/punctuation — proves normalize_company_name is
 * doing real work, not just an accidental exact-string match. */
const CLAIM_ORG_NAME_VARIANT = `claim-test CO. ${NONCE}`;

function externalPosting(title: string, extra: Record<string, unknown> = {}) {
  return {
    source_type: "external" as const,
    organization_id: null,
    title: `CLAIM-TEST ${title} ${NONCE}`,
    company_name: `CLAIM-TEST Unrelated Co ${tag}`,
    description: "Fixture external posting for the claim-listing suite.",
    structured_jd: {},
    status: "open" as const,
    posted_at: new Date().toISOString(),
    dedup_fingerprint: `claim-fixture-${tag}-${title}`,
    external_source: "claim-suite-fixture",
    ...extra,
  };
}

beforeAll(async () => {
  [claimingOwner, strangerUser] = await Promise.all([
    createAuthedTestUser("claim-owner"),
    createAuthedTestUser("claim-stranger"),
  ]);

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .insert([
      {
        name: CLAIM_ORG_NAME,
        domain: CLAIM_DOMAIN,
        verified: true,
        created_by: claimingOwner.id,
      },
      {
        name: `CLAIM-TEST Unverified ${NONCE}`,
        domain: `claim-unverified-${tag}.example`,
        verified: false,
        created_by: claimingOwner.id,
      },
      {
        name: `CLAIM-TEST Unrelated Org ${NONCE}`,
        domain: `claim-unrelated-${tag}.example`,
        verified: true,
        created_by: claimingOwner.id,
      },
    ])
    .select("id, name");
  if (orgErr || !orgs) throw new Error(`fixture orgs: ${orgErr?.message}`);
  claimingOrgId = orgs.find((o) => o.name === CLAIM_ORG_NAME)!.id;
  unverifiedOrgId = orgs.find((o) => o.name.includes("Unverified"))!.id;
  unrelatedOrgId = orgs.find((o) => o.name.includes("Unrelated Org"))!.id;

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: claimingOrgId, user_id: claimingOwner.id, role: "owner" });
  if (memberErr) throw new Error(`fixture membership: ${memberErr.message}`);

  const { data: jobs, error: jobErr } = await admin
    .from("job_postings")
    .insert([
      // HIGH CONFIDENCE: external_url hostname matches the claiming org's domain.
      externalPosting("DomainMatch", { external_url: `https://www.${CLAIM_DOMAIN}/careers/123` }),
      // WEAK: only the (normalised) company name matches — different domain.
      externalPosting("NameMatch", {
        company_name: CLAIM_ORG_NAME_VARIANT,
        external_url: `https://jobs.example-other.test/${tag}`,
      }),
      // Matches neither signal — must never be claimable by claimingOrgId.
      externalPosting("NoMatch", { external_url: `https://jobs.completely-unrelated.test/${tag}` }),
      // Already claimed by another org — must not show up as a fresh candidate.
      externalPosting("AlreadyClaimed", {
        external_url: `https://www.${CLAIM_DOMAIN}/careers/456`,
        claimed_by_organization_id: unrelatedOrgId,
        claimed_at: new Date().toISOString(),
        status: "removed" as const,
        removed_at: new Date().toISOString(),
        removal_reason: "Fixture: pre-claimed by another org.",
      }),
      // Domain matches the UNVERIFIED org — isolates the "not verified" failure
      // from "not a match".
      externalPosting("UnverifiedOrgMatch", {
        external_url: `https://careers.claim-unverified-${tag}.example/role`,
      }),
      // Its own fixture for the restore-clears-claim-marker trigger test.
      externalPosting("RestoreFixture", { external_url: `https://www.${CLAIM_DOMAIN}/careers/789` }),
      // Its own fixture for the ORIGINAL 0056 "stays removed" trigger branch —
      // proving 0129's new elsif didn't disturb the existing if.
      externalPosting("StaysRemoved", {
        status: "removed" as const,
        removed_at: new Date().toISOString(),
        removal_reason: "Fixture: pre-existing removal, unrelated to claiming.",
      }),
    ])
    .select("id, title");
  if (jobErr || !jobs) throw new Error(`fixture postings: ${jobErr?.message}`);

  const byTitle = (needle: string) => jobs.find((j) => j.title.includes(needle))!.id;
  domainMatchJobId = byTitle("DomainMatch");
  nameMatchJobId = byTitle("NameMatch");
  noMatchJobId = byTitle("NoMatch");
  alreadyClaimedJobId = byTitle("AlreadyClaimed");
  unverifiedOrgMatchJobId = byTitle("UnverifiedOrgMatch");
  restoreFixtureJobId = byTitle("RestoreFixture");
  staysRemovedFixtureJobId = byTitle("StaysRemoved");

  // A seeker who applied to the domain-match posting BEFORE it gets claimed —
  // the row this whole suite's "applications are never mutated" claim is
  // actually about.
  const seeker = await createAuthedTestUser("claim-seeker");
  seekerUserId = seeker.id;
  const { data: application, error: appErr } = await admin
    .from("applications")
    .insert({
      user_id: seekerUserId,
      job_posting_id: domainMatchJobId,
      stage: "applied",
      source: "manual",
      applied_at: new Date().toISOString(),
      // Mirrors what loadJobSnapshot (src/lib/applications/job-snapshot.ts)
      // writes at real apply time — this is the fallback the Job Tracker
      // reads once RLS stops admitting the removed row.
      manual_job_snapshot: {
        companyName: `CLAIM-TEST Unrelated Co ${tag}`,
        title: `CLAIM-TEST DomainMatch ${NONCE}`,
        url: `https://www.${CLAIM_DOMAIN}/careers/123`,
      },
    })
    .select("id")
    .single();
  if (appErr || !application) throw new Error(`fixture application: ${appErr?.message}`);
  seekerApplicationId = application.id;
});

afterAll(async () => {
  if (seekerApplicationId) await admin.from("applications").delete().eq("id", seekerApplicationId);
  if (seekerUserId) await deleteTestUsers([seekerUserId]);

  // Every posting this suite created or that a claim created, by company_name
  // — most have organization_id null (external) so an org-scoped delete
  // would miss them, and a claim's own new internal posting is scoped to
  // claimingOrgId, which deleteTestOrgs below removes via its own cascade.
  const { error: jobsErr } = await admin
    .from("job_postings")
    .delete()
    .or(`company_name.eq.CLAIM-TEST Unrelated Co ${tag},company_name.eq.${CLAIM_ORG_NAME}`);
  if (jobsErr) console.error("[claim-listing cleanup] external postings:", jobsErr.message);

  await admin.from("organization_members").delete().eq("organization_id", claimingOrgId);
  await deleteTestOrgs([claimingOrgId, unverifiedOrgId, unrelatedOrgId]);
  await deleteTestUsers([claimingOwner.id, strangerUser.id]);
});

describe("job_posting_claim_candidates — the matching signals", () => {
  it("finds the domain-hostname match, confidence 'domain'", async () => {
    const { data, error } = await claimingOwner.client.rpc("job_posting_claim_candidates", {
      p_organization_id: claimingOrgId,
    });
    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.id === domainMatchJobId);
    expect(row, "the domain-match posting should be a candidate").toBeTruthy();
    expect(row?.confidence).toBe("domain");
  });

  it("finds the company-name-only match, confidence 'name' — case/punctuation-insensitive", async () => {
    const { data, error } = await claimingOwner.client.rpc("job_posting_claim_candidates", {
      p_organization_id: claimingOrgId,
    });
    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.id === nameMatchJobId);
    expect(row, "the name-match posting should be a candidate").toBeTruthy();
    expect(row?.confidence, "a bare name match must be reported as the WEAKER signal, never 'domain'").toBe(
      "name",
    );
  });

  it("never suggests a posting that matches neither signal", async () => {
    const { data, error } = await claimingOwner.client.rpc("job_posting_claim_candidates", {
      p_organization_id: claimingOrgId,
    });
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(noMatchJobId), "an unrelated posting must never be suggested").toBe(false);
  });

  it("excludes a posting someone else already claimed", async () => {
    const { data, error } = await claimingOwner.client.rpc("job_posting_claim_candidates", {
      p_organization_id: claimingOrgId,
    });
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(alreadyClaimedJobId), "an already-claimed posting must not resurface as a candidate").toBe(
      false,
    );
  });
});

describe("claim_external_job_posting — the actual claim", () => {
  it("refuses a name-mismatched, domain-mismatched posting even if asked directly (defense in depth)", async () => {
    const { data, error } = await admin.rpc("claim_external_job_posting", {
      p_organization_id: claimingOrgId,
      p_external_job_posting_id: noMatchJobId,
      p_title: "Should never be created",
      p_description: "This claim attempt should be refused before anything is written. ".repeat(2),
      p_location: null as unknown as string,
    });
    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.ok, "a non-matching posting must never be claimable").toBe(false);
    expect(row?.reason).toBe("not_a_match");

    const { data: unchanged } = await admin
      .from("job_postings")
      .select("status, claimed_by_organization_id")
      .eq("id", noMatchJobId)
      .single();
    expect(unchanged?.status).toBe("open");
    expect(unchanged?.claimed_by_organization_id).toBeNull();
  });

  it("refuses to claim into an UNVERIFIED organisation", async () => {
    const { data, error } = await admin.rpc("claim_external_job_posting", {
      p_organization_id: unverifiedOrgId,
      p_external_job_posting_id: unverifiedOrgMatchJobId,
      p_title: "Should never be created",
      p_description: "This claim attempt should be refused: the org is not verified. ".repeat(2),
      p_location: null as unknown as string,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("org_not_verified");
  });

  it("claims a domain-matched posting: creates a new internal posting and marks the source removed+claimed", async () => {
    const newTitle = `CLAIM-TEST Claimed Role ${NONCE}`;
    const { data, error } = await admin.rpc("claim_external_job_posting", {
      p_organization_id: claimingOrgId,
      p_external_job_posting_id: domainMatchJobId,
      p_title: newTitle,
      p_description: "A brand new posting written by the employer, at least forty characters long.",
      p_location: "Lagos, Nigeria",
    });
    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.ok, row?.reason).toBe(true);
    expect(row?.job_posting_id).toBeTruthy();

    const { data: created } = await admin
      .from("job_postings")
      .select("source_type, organization_id, title, status, dedup_fingerprint")
      .eq("id", row!.job_posting_id!)
      .single();
    expect(created?.source_type).toBe("internal");
    expect(created?.organization_id).toBe(claimingOrgId);
    expect(created?.title).toBe(newTitle);
    expect(created?.status).toBe("open");

    const { data: source } = await admin
      .from("job_postings")
      .select("status, claimed_by_organization_id, claimed_at, removed_at, removal_reason")
      .eq("id", domainMatchJobId)
      .single();
    expect(source?.status, "the claimed external row must be removed from every listing surface").toBe(
      "removed",
    );
    expect(source?.claimed_by_organization_id).toBe(claimingOrgId);
    expect(source?.claimed_at).toBeTruthy();
    expect(source?.removed_at).toBeTruthy();
  });

  it("refuses a second claim of the same, now-claimed external posting", async () => {
    const { data, error } = await admin.rpc("claim_external_job_posting", {
      p_organization_id: claimingOrgId,
      p_external_job_posting_id: domainMatchJobId,
      p_title: "A duplicate claim attempt",
      p_description: "This must be refused because the posting was already claimed above. ".repeat(2),
      p_location: null as unknown as string,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("already_claimed");
  });

  it("never mutates the seeker's existing applications row", async () => {
    // The whole point: the claim above happened; this row must be exactly
    // what it was before, still pointing at the ORIGINAL external posting.
    const { data: application, error } = await admin
      .from("applications")
      .select("job_posting_id, stage, manual_job_snapshot")
      .eq("id", seekerApplicationId)
      .single();
    expect(error).toBeNull();
    expect(
      application?.job_posting_id,
      "an existing application must keep pointing at the external posting it was actually made against",
    ).toBe(domainMatchJobId);
    expect(application?.stage).toBe("applied");
    expect(
      (application?.manual_job_snapshot as { companyName?: string } | null)?.companyName,
    ).toBe(`CLAIM-TEST Unrelated Co ${tag}`);

    // And no application anywhere was silently repointed at the NEW posting.
    const { data: created } = await admin
      .from("job_postings")
      .select("id")
      .eq("dedup_fingerprint", `claimed:${domainMatchJobId}`)
      .single();
    const { count } = await admin
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("job_posting_id", created!.id);
    expect(count ?? 0).toBe(0);
  });

  it("claims the weaker name-only match too, once a human has reviewed and confirmed it", async () => {
    // The product rule this proves: a name match is presented as a weaker
    // suggestion (asserted above), never silently auto-attached — but once an
    // employer explicitly confirms it (this call), it is a real claim like any
    // other. There is no separate "auto-claim on name" code path to test
    // the ABSENCE of; this is that absence made concrete — the only way a
    // name-matched posting is ever claimed is this same explicit RPC call.
    const { data, error } = await admin.rpc("claim_external_job_posting", {
      p_organization_id: claimingOrgId,
      p_external_job_posting_id: nameMatchJobId,
      p_title: `CLAIM-TEST Claimed via name match ${NONCE}`,
      p_description: "Confirmed by a human on the review screen before this call was ever made.",
      p_location: null as unknown as string,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.ok, data?.[0]?.reason).toBe(true);
  });
});

describe("job_postings_internal_has_org — still a hard constraint", () => {
  it("refuses an INTERNAL row with no organisation, even from the service role", async () => {
    const { data, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: null,
        company_name: "CLAIM-TEST Should Fail",
        title: `CLAIM-TEST Constraint Probe Internal ${NONCE}`,
        description: "Should be refused by the CHECK constraint, not application code.",
        structured_jd: {},
        status: "open",
        dedup_fingerprint: `claim-constraint-internal-${tag}`,
      })
      .select("id");
    expect(data).toBeNull();
    expect(error, "an internal posting with no organisation_id must violate the CHECK constraint").toBeTruthy();
    expect(error?.code).toBe("23514");
  });

  it("refuses an EXTERNAL row with an organisation, even from the service role", async () => {
    const { data, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "external",
        organization_id: claimingOrgId,
        company_name: "CLAIM-TEST Should Also Fail",
        title: `CLAIM-TEST Constraint Probe External ${NONCE}`,
        description: "Should be refused by the CHECK constraint, not application code.",
        structured_jd: {},
        status: "open",
        dedup_fingerprint: `claim-constraint-external-${tag}`,
      })
      .select("id");
    expect(data).toBeNull();
    expect(error, "an external posting with an organisation_id must violate the CHECK constraint").toBeTruthy();
    expect(error?.code).toBe("23514");
  });
});

describe("claimed_by_organization_id / claimed_at are not client-writable", () => {
  it("a session UPDATE cannot set claimed_by_organization_id on the org's own posting", async () => {
    // Uses the posting claim_external_job_posting just created, owned by
    // claimingOwner's own organisation — the most favourable case for an
    // attacker to try, since it IS their own row.
    const { data: own } = await admin
      .from("job_postings")
      .select("id")
      .eq("organization_id", claimingOrgId)
      .eq("source_type", "internal")
      .limit(1)
      .single();

    const { error } = await claimingOwner.client
      .from("job_postings")
      .update({ claimed_by_organization_id: unrelatedOrgId })
      .eq("id", own!.id);
    expect(error, "claimed_by_organization_id must not be UPDATE-able by a client role").toBeTruthy();
    expect(error?.code).toBe("42501");

    const { data: after } = await admin
      .from("job_postings")
      .select("claimed_by_organization_id")
      .eq("id", own!.id)
      .single();
    expect(after?.claimed_by_organization_id, "the refused write must not have landed").toBeNull();
  });

  it("cannot smuggle claimed_by_organization_id/claimed_at into a brand-new INSERT", async () => {
    const { data, error } = await claimingOwner.client
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: claimingOrgId,
        company_name: CLAIM_ORG_NAME,
        title: `CLAIM-TEST Smuggled Claim Columns ${NONCE}`,
        description: "Should be rejected — claim columns named on the row's own creation.",
        structured_jd: {},
        status: "open",
        dedup_fingerprint: `claim-smuggle-${tag}`,
        claimed_by_organization_id: claimingOrgId,
        claimed_at: new Date().toISOString(),
      })
      .select("id");

    if (data?.[0]?.id) {
      // Clean up even if the assertion below is about to fail.
      await admin.from("job_postings").delete().eq("id", data[0].id);
    }
    expect(error, "an insert naming claimed_by_organization_id/claimed_at must be rejected").toBeTruthy();
    expect(error?.code).toBe("42501");
  });
});

describe("the claimed row's fate matches what 0128/0129 decided", () => {
  it("is excluded by the feed's own predicate (status = 'open')", async () => {
    // The literal filter the feed applies (FEED_COLUMNS query in
    // src/app/(app)/jobs/page.tsx) — not a paraphrase.
    const { data } = await admin.from("job_postings").select("id").eq("status", "open").eq(
      "id",
      domainMatchJobId,
    );
    expect(data ?? []).toHaveLength(0);
  });

  it("is no longer publicly readable at all, its claim notwithstanding", async () => {
    const { data } = await strangerUser.client.from("job_postings").select("id").eq("id", domainMatchJobId).maybeSingle();
    expect(data, "a claimed (removed) external posting must not be publicly readable").toBeNull();
  });

  it("an admin restore clears the claim marker along with removed_at (0129's trigger fix)", async () => {
    // Claim a dedicated fixture first, so this test doesn't depend on
    // mutating a row another test already asserted on.
    const { data: claim } = await admin.rpc("claim_external_job_posting", {
      p_organization_id: claimingOrgId,
      p_external_job_posting_id: restoreFixtureJobId,
      p_title: `CLAIM-TEST Restore Fixture Claimed ${NONCE}`,
      p_description: "Claimed only so the restore-clears-marker trigger can be exercised on it.",
      p_location: null as unknown as string,
    });
    expect(claim?.[0]?.ok, claim?.[0]?.reason).toBe(true);

    const { data: claimed } = await admin
      .from("job_postings")
      .select("claimed_by_organization_id")
      .eq("id", restoreFixtureJobId)
      .single();
    expect(claimed?.claimed_by_organization_id).toBe(claimingOrgId);

    // The sanctioned restore shape admin_moderate_job_posting's own 'restore'
    // branch uses: status leaves 'removed' AND removed_at clears in the same
    // statement. Done directly here (not through the admin RPC, which needs
    // a permissioned admin actor) to isolate the TRIGGER behaviour this
    // migration actually added.
    await admin
      .from("job_postings")
      .update({ status: "closed", removed_at: null, removal_reason: null })
      .eq("id", restoreFixtureJobId);

    const { data: restored } = await admin
      .from("job_postings")
      .select("status, removed_at, claimed_by_organization_id, claimed_at")
      .eq("id", restoreFixtureJobId)
      .single();
    expect(restored?.status).toBe("closed");
    expect(restored?.removed_at).toBeNull();
    expect(
      restored?.claimed_by_organization_id,
      "a restore must clear the claim marker — a live row must not carry a stale claimed-by",
    ).toBeNull();
    expect(restored?.claimed_at).toBeNull();
  });

  it("the ORIGINAL 0056 'stays removed' branch is unaffected by 0129's new elsif", async () => {
    // An update that tries to leave `removed` WITHOUT clearing removed_at
    // must still be silently reverted — the pre-existing behaviour this
    // migration must not have disturbed.
    await admin
      .from("job_postings")
      .update({ status: "closed" }) // removed_at NOT cleared
      .eq("id", staysRemovedFixtureJobId);

    const { data } = await admin
      .from("job_postings")
      .select("status, removed_at")
      .eq("id", staysRemovedFixtureJobId)
      .single();
    expect(data?.status, "a status change without clearing removed_at must be reverted").toBe("removed");
    expect(data?.removed_at).toBeTruthy();
  });
});
