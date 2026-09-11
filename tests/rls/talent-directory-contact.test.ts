/**
 * send-157 — Talent Directory contact requests (0155/0156). Proves, against
 * the real database:
 *
 *  1. request_talent_directory_contact re-derives entitlement from the
 *     org's own subscription row, not from anything the caller merely
 *     asserts — an unsubscribed org gets 'not_subscribed', a subscribed org
 *     asking about a candidate who has since opted out or lost verification
 *     gets 'candidate_not_listed'.
 *  2. The partial unique index actually blocks a second PENDING request for
 *     the same (org, candidate) pair, and a fresh request after a decline is
 *     genuinely allowed (the index only blocks a second PENDING row).
 *  3. The per-organisation rate limit (20/day, consume_anonymous_rate_limit)
 *     is real and per-org, not per-candidate or global.
 *  4. respond_to_talent_directory_contact_request only ever moves a PENDING
 *     row belonging to the candidate passed in — a wrong candidate id or an
 *     already-decided row is a no-op (false), never a mutation.
 *  5. RLS: a candidate reads only requests addressed to them; an org member
 *     reads only their own org's sent requests; an unrelated org/candidate
 *     sees nothing for either.
 *
 * 0156 fixed a real defect in 0155's first cut: it re-checked org membership
 * against auth.uid(), but request_talent_directory_contact is service_role
 * only and is called via createServiceRoleClient() (contact-runner.ts),
 * which carries no per-user JWT — auth.uid() is always null there, so that
 * check could never pass. This suite calls the RPC the same way the runner
 * does (via `admin`, trusting organizationId/requestedBy as already-resolved
 * values) rather than assuming the pre-0156 shape.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory contact RLS suite cannot run: ${key} is not set.`);
}

let candidate: { id: string; client: DB };
let otherCandidate: { id: string; client: DB };
/** Verified+opted-in like `candidate`, but never targeted by any OTHER test in this file — kept clean so the cross-org rate-limit independence check below isn't confused by `candidate`'s own pending/decided history with subscribedOrgId. */
let independenceCheckCandidate: { id: string; client: DB };

let subscribedOrgId: string;
let subscribedOrgOwner: { id: string; client: DB };
let unsubscribedOrgId: string;
let unsubscribedOrgOwner: { id: string; client: DB };
let outsiderOrgId: string;
let outsiderOrgOwner: { id: string; client: DB };

let planId: string;
const subscriptionIds: string[] = [];
const contactRequestIds: string[] = [];

async function insertOrg(name: string, ownerId: string) {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `${name} ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function activeSubscription(organizationId: string) {
  const { data, error } = await admin
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: organizationId,
      plan_id: planId,
      expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  subscriptionIds.push(data!.id as string);
}

async function request(
  organizationId: string,
  requestedBy: string,
  candidateId: string,
  message = "We think you'd be a great fit for a role we're hiring for.",
) {
  const { data, error } = await admin.rpc("request_talent_directory_contact", {
    p_organization_id: organizationId,
    p_candidate_id: candidateId,
    p_message: message,
    p_requested_by: requestedBy,
  });
  if (error) throw error;
  const row = data![0];
  if (row.request_id) contactRequestIds.push(row.request_id);
  return row;
}

beforeAll(async () => {
  [candidate, otherCandidate, independenceCheckCandidate, subscribedOrgOwner, unsubscribedOrgOwner, outsiderOrgOwner] =
    await Promise.all([
      createAuthedTestUser("tdcrls-candidate"),
      createAuthedTestUser("tdcrls-other-candidate"),
      createAuthedTestUser("tdcrls-independence-candidate"),
      createAuthedTestUser("tdcrls-org-owner-sub"),
      createAuthedTestUser("tdcrls-org-owner-nosub"),
      createAuthedTestUser("tdcrls-org-owner-outsider"),
    ]);

  await Promise.all(
    [candidate.id, independenceCheckCandidate.id].map((id) =>
      admin
        .from("profiles")
        .update({
          talent_verification_status: "verified",
          talent_directory_opt_in: true,
          talent_verified_at: new Date().toISOString(),
        })
        .eq("id", id),
    ),
  );

  [subscribedOrgId, unsubscribedOrgId, outsiderOrgId] = await Promise.all([
    insertOrg("TDCRLS Subscribed Org", subscribedOrgOwner.id),
    insertOrg("TDCRLS Unsubscribed Org", unsubscribedOrgOwner.id),
    insertOrg("TDCRLS Outsider Org", outsiderOrgOwner.id),
  ]);

  await Promise.all([
    admin.from("organization_members").insert({ organization_id: subscribedOrgId, user_id: subscribedOrgOwner.id, role: "owner" }),
    admin.from("organization_members").insert({ organization_id: unsubscribedOrgId, user_id: unsubscribedOrgOwner.id, role: "owner" }),
    admin.from("organization_members").insert({ organization_id: outsiderOrgId, user_id: outsiderOrgOwner.id, role: "owner" }),
  ]);

  const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
  planId = plan!.id as string;

  await Promise.all([activeSubscription(subscribedOrgId), activeSubscription(outsiderOrgId)]);
  // A real, EXPIRED subscription for the "unsubscribed" org — the stronger
  // case, same reasoning talent-directory.test.ts's own fixtures use.
  const { data: lapsed } = await admin
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: unsubscribedOrgId,
      plan_id: planId,
      expires_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
      status: "lapsed",
    })
    .select("id")
    .single();
  subscriptionIds.push(lapsed!.id as string);
}, 60_000);

afterAll(async () => {
  if (contactRequestIds.length) {
    await admin.from("talent_directory_contact_requests").delete().in("id", contactRequestIds);
  }
  if (subscriptionIds.length) {
    await admin.from("talent_directory_subscriptions").delete().in("id", subscriptionIds);
  }
  await admin
    .from("anonymous_rate_limits")
    .delete()
    .eq("bucket", "talent_directory_contact")
    .in("rate_key", [subscribedOrgId, unsubscribedOrgId, outsiderOrgId]);
  await deleteTestOrgs([subscribedOrgId, unsubscribedOrgId, outsiderOrgId]);
  await deleteTestUsers([
    candidate.id,
    otherCandidate.id,
    independenceCheckCandidate.id,
    subscribedOrgOwner.id,
    unsubscribedOrgOwner.id,
    outsiderOrgOwner.id,
  ]);
}, 60_000);

describe("request_talent_directory_contact: entitlement re-derived from the org's own subscription row", () => {
  it("MONEY: an org with no active subscription (a real, lapsed row) is refused, not charged a request", async () => {
    const result = await request(unsubscribedOrgId, unsubscribedOrgOwner.id, candidate.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_subscribed");
    expect(result.request_id).toBeNull();
  });

  it("a subscribed org sending to a candidate who is verified+opted-in succeeds", async () => {
    const result = await request(subscribedOrgId, subscribedOrgOwner.id, candidate.id);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("ok");
    expect(result.request_id).not.toBeNull();

    const { data: row } = await admin
      .from("talent_directory_contact_requests")
      .select("organization_id, candidate_id, requested_by, status, message")
      .eq("id", result.request_id!)
      .single();
    expect(row?.organization_id).toBe(subscribedOrgId);
    expect(row?.candidate_id).toBe(candidate.id);
    expect(row?.status).toBe("pending");
    // Proves 0156's fix directly: requested_by is the explicit p_requested_by
    // passed in, not a always-null auth.uid() read inside the function.
    expect(row?.requested_by, "0156 regression: requested_by must not be null").toBe(subscribedOrgOwner.id);
  });

  it("PRIVACY: a subscribed org asking about a candidate who was never opted-in/verified gets candidate_not_listed", async () => {
    const result = await request(subscribedOrgId, subscribedOrgOwner.id, otherCandidate.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("candidate_not_listed");
  });

  it("refuses an empty or whitespace-only message, on an org/candidate pair that otherwise fully qualifies", async () => {
    // A different subscribed org than the one used above, so this can't
    // collide with the partial unique index on (org, candidate) — this is
    // testing the message check in isolation, not request de-duplication.
    const result = await request(outsiderOrgId, outsiderOrgOwner.id, candidate.id, "   ");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("message_required");
  });

  it("the partial unique index blocks a second PENDING request for the same (org, candidate) pair", async () => {
    // subscribedOrgId -> candidate already has a pending row from the test
    // above.
    const result = await request(subscribedOrgId, subscribedOrgOwner.id, candidate.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_pending");
    expect(result.request_id).toBeNull();
  });

  it("a fresh request is allowed again after the prior one is decided (index only blocks a second PENDING row)", async () => {
    const { data: pending } = await admin
      .from("talent_directory_contact_requests")
      .select("id")
      .eq("organization_id", subscribedOrgId)
      .eq("candidate_id", candidate.id)
      .eq("status", "pending")
      .single();

    const { data: declined } = await admin.rpc("respond_to_talent_directory_contact_request", {
      p_request_id: pending!.id,
      p_candidate_id: candidate.id,
      p_approve: false,
    });
    expect(declined).toBe(true);

    const result = await request(subscribedOrgId, subscribedOrgOwner.id, candidate.id, "Following up after your decline.");
    expect(result.ok, "a new request after a decline must be allowed, not blocked by history").toBe(true);
  });
});

describe("request_talent_directory_contact: per-organisation rate limit (20/day)", () => {
  it("the 21st request from the SAME org in the window is rate_limited, even though other orgs are unaffected", async () => {
    // Pre-exhaust the shared consume_anonymous_rate_limit counter directly,
    // under the exact (key, bucket) the RPC itself uses — proves the
    // integration without needing 20 real distinct eligible candidates.
    for (let i = 0; i < 20; i++) {
      const { error } = await admin.rpc("consume_anonymous_rate_limit", {
        p_key: outsiderOrgId,
        p_bucket: "talent_directory_contact",
        p_limit: 20,
        p_window_seconds: 86400,
      });
      expect(error).toBeNull();
    }

    const result = await request(outsiderOrgId, outsiderOrgOwner.id, candidate.id, "One too many.");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rate_limited");

    // A DIFFERENT org, same instant, a candidate with no prior history
    // against either org (so a stray already_pending can't masquerade as
    // "not rate limited"): unaffected — the limit is per-organisation, not
    // global.
    const other = await request(subscribedOrgId, subscribedOrgOwner.id, independenceCheckCandidate.id, "Not rate limited.");
    expect(other.ok, "the rate limit must be scoped per-organisation, not shared across orgs").toBe(true);
  });
});

describe("respond_to_talent_directory_contact_request: only ever moves a PENDING row belonging to the passed candidate", () => {
  let pendingId: string;

  beforeAll(async () => {
    const result = await request(subscribedOrgId, subscribedOrgOwner.id, candidate.id, "For the approve/decline suite.");
    // If already_pending (from ordering with the describe block above),
    // fetch the existing pending row instead of failing.
    if (result.ok) {
      pendingId = result.request_id!;
    } else {
      const { data } = await admin
        .from("talent_directory_contact_requests")
        .select("id")
        .eq("organization_id", subscribedOrgId)
        .eq("candidate_id", candidate.id)
        .eq("status", "pending")
        .single();
      pendingId = data!.id as string;
    }
  });

  it("SECURITY: the WRONG candidate id cannot approve someone else's request", async () => {
    const { data: ok, error } = await admin.rpc("respond_to_talent_directory_contact_request", {
      p_request_id: pendingId,
      p_candidate_id: otherCandidate.id,
      p_approve: true,
    });
    expect(error).toBeNull();
    expect(ok, "a request must only ever be decided by its own candidate_id").toBe(false);

    const { data: row } = await admin
      .from("talent_directory_contact_requests")
      .select("status")
      .eq("id", pendingId)
      .single();
    expect(row?.status).toBe("pending");
  });

  it("the real candidate can approve it", async () => {
    const { data: ok, error } = await admin.rpc("respond_to_talent_directory_contact_request", {
      p_request_id: pendingId,
      p_candidate_id: candidate.id,
      p_approve: true,
    });
    expect(error).toBeNull();
    expect(ok).toBe(true);

    const { data: row } = await admin
      .from("talent_directory_contact_requests")
      .select("status, decided_at")
      .eq("id", pendingId)
      .single();
    expect(row?.status).toBe("approved");
    expect(row?.decided_at).not.toBeNull();
  });

  it("an already-decided request is a no-op, not an error or a second mutation", async () => {
    const { data: ok, error } = await admin.rpc("respond_to_talent_directory_contact_request", {
      p_request_id: pendingId,
      p_candidate_id: candidate.id,
      p_approve: false,
    });
    expect(error).toBeNull();
    expect(ok, "re-deciding an already-decided row must be a no-op").toBe(false);

    const { data: row } = await admin
      .from("talent_directory_contact_requests")
      .select("status")
      .eq("id", pendingId)
      .single();
    expect(row?.status, "a second call must not flip an already-approved row to declined").toBe("approved");
  });
});

describe("RLS: candidate reads their own incoming requests, an org member reads their own org's sent requests, and nothing crosses", () => {
  it("the candidate sees requests addressed to them, via their own session", async () => {
    const { data, error } = await candidate.client
      .from("talent_directory_contact_requests")
      .select("id, organization_id, candidate_id")
      .eq("organization_id", subscribedOrgId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.candidate_id).toBe(candidate.id);
  });

  it("PRIVACY: an unrelated candidate sees nothing for a request that isn't theirs", async () => {
    const { data, error } = await otherCandidate.client
      .from("talent_directory_contact_requests")
      .select("id")
      .eq("organization_id", subscribedOrgId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("an org member reads their own org's sent requests", async () => {
    const { data, error } = await subscribedOrgOwner.client
      .from("talent_directory_contact_requests")
      .select("id, organization_id, candidate_id")
      .eq("candidate_id", candidate.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.organization_id).toBe(subscribedOrgId);
  });

  it("PRIVACY: an outsider org with no request at all sees nothing, not an error", async () => {
    const { data, error } = await outsiderOrgOwner.client
      .from("talent_directory_contact_requests")
      .select("id")
      .eq("candidate_id", candidate.id)
      .eq("organization_id", subscribedOrgId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("MONEY: an unsubscribed org member cannot read the subscribed org's sent requests either — RLS is membership-scoped, not subscription-scoped, and membership here is genuinely absent", async () => {
    const { data, error } = await unsubscribedOrgOwner.client
      .from("talent_directory_contact_requests")
      .select("id")
      .eq("organization_id", subscribedOrgId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("respond_to_talent_directory_contact_request: service_role only, not reachable by an authenticated session directly", () => {
  it("a candidate's own authenticated client cannot call the RPC directly — no EXECUTE grant to authenticated", async () => {
    const { error } = await candidate.client.rpc("respond_to_talent_directory_contact_request", {
      p_request_id: randomUUID(),
      p_candidate_id: candidate.id,
      p_approve: true,
    });
    expect(error, "MONEY/SECURITY BUG: an authenticated session could call a service_role-only RPC").not.toBeNull();
  });

  it("an authenticated org session cannot call request_talent_directory_contact directly either", async () => {
    const { error } = await subscribedOrgOwner.client.rpc("request_talent_directory_contact", {
      p_organization_id: subscribedOrgId,
      p_candidate_id: candidate.id,
      p_message: "trying to bypass the Server Action",
      p_requested_by: subscribedOrgOwner.id,
    });
    expect(error, "MONEY/SECURITY BUG: an authenticated session could call a service_role-only RPC").not.toBeNull();
  });
});
