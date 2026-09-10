/**
 * 0135's own header calls the directory search path "the highest-risk part
 * of this slice" — an employer querying across other users' profile data.
 * This suite proves the two claims that header makes, directly, rather than
 * assuming them from the function's shape:
 *
 *  1. An unverified or opted-out seeker never appears in a local employer's
 *     directory search under ANY query path — not `talent_directory_search`,
 *     not `talent_directory_portfolio_items`, not a direct table read.
 *  2. `talent_directory_search`/`talent_directory_portfolio_items` genuinely
 *     cannot read a seeker's data beyond what verification+opt-in explicitly
 *     exposes — gated on the CALLER's own entitlement (an active
 *     subscription for their org), re-derived from auth.uid(), never from a
 *     client-supplied organization id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory RLS suite cannot run: ${key} is not set.`);
}

let verifiedOptedIn: { id: string; client: DB };
let verifiedNotOptedIn: { id: string; client: DB };
let optedInNotVerified: { id: string; client: DB };
let neither: { id: string; client: DB };

let subscribedOrgId: string;
let subscribedOrgOwner: { id: string; client: DB };
let unsubscribedOrgId: string;
let unsubscribedOrgOwner: { id: string; client: DB };
let outsider: { id: string; client: DB };

let subscriptionId: string;
let planId: string;

beforeAll(async () => {
  [verifiedOptedIn, verifiedNotOptedIn, optedInNotVerified, neither, subscribedOrgOwner, unsubscribedOrgOwner, outsider] =
    await Promise.all([
      createAuthedTestUser("tdrls-verified-optedin"),
      createAuthedTestUser("tdrls-verified-notoptedin"),
      createAuthedTestUser("tdrls-optedin-notverified"),
      createAuthedTestUser("tdrls-neither"),
      createAuthedTestUser("tdrls-org-owner-sub"),
      createAuthedTestUser("tdrls-org-owner-nosub"),
      createAuthedTestUser("tdrls-outsider"),
    ]);

  await Promise.all([
    admin
      .from("profiles")
      .update({ talent_verification_status: "verified", talent_directory_opt_in: true, talent_verified_at: new Date().toISOString() })
      .eq("id", verifiedOptedIn.id),
    admin
      .from("profiles")
      .update({ talent_verification_status: "verified", talent_directory_opt_in: false, talent_verified_at: new Date().toISOString() })
      .eq("id", verifiedNotOptedIn.id),
    admin
      .from("profiles")
      .update({ talent_verification_status: "unverified", talent_directory_opt_in: true })
      .eq("id", optedInNotVerified.id),
  ]);

  await admin.from("talent_portfolio_items").insert([
    { user_id: verifiedOptedIn.id, title: "Verified & opted-in item" },
    { user_id: verifiedNotOptedIn.id, title: "Verified but NOT opted-in item" },
    { user_id: optedInNotVerified.id, title: "Opted-in but NOT verified item" },
  ]);

  const { data: org1 } = await admin
    .from("organizations")
    .insert({ name: `TDRLS Subscribed Org ${randomUUID().slice(0, 8)}`, created_by: subscribedOrgOwner.id, verified: true })
    .select("id")
    .single();
  subscribedOrgId = org1!.id;
  const { data: org2 } = await admin
    .from("organizations")
    .insert({ name: `TDRLS Unsubscribed Org ${randomUUID().slice(0, 8)}`, created_by: unsubscribedOrgOwner.id, verified: true })
    .select("id")
    .single();
  unsubscribedOrgId = org2!.id;

  await Promise.all([
    admin.from("organization_members").insert({ organization_id: subscribedOrgId, user_id: subscribedOrgOwner.id, role: "owner" }),
    admin.from("organization_members").insert({ organization_id: unsubscribedOrgId, user_id: unsubscribedOrgOwner.id, role: "owner" }),
  ]);

  const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
  planId = plan!.id;
  const { data: subscription } = await admin
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: subscribedOrgId,
      plan_id: planId,
      expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      status: "active",
    })
    .select("id")
    .single();
  subscriptionId = subscription!.id;
  // The unsubscribed org gets an EXPIRED subscription, not none at all — the
  // stronger case: a real row that simply doesn't qualify, not an absent one.
  await admin.from("talent_directory_subscriptions").insert({
    organization_id: unsubscribedOrgId,
    plan_id: planId,
    expires_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
    status: "lapsed",
  });
}, 60_000);

afterAll(async () => {
  await admin.from("talent_directory_subscriptions").delete().eq("id", subscriptionId);
  await admin.from("talent_directory_subscriptions").delete().eq("organization_id", unsubscribedOrgId);
  await deleteTestOrgs([subscribedOrgId, unsubscribedOrgId]);
  await deleteTestUsers([
    verifiedOptedIn.id,
    verifiedNotOptedIn.id,
    optedInNotVerified.id,
    neither.id,
    subscribedOrgOwner.id,
    unsubscribedOrgOwner.id,
    outsider.id,
  ]);
}, 60_000);

describe("talent_directory_search: only verified+opted-in candidates, only for an entitled caller", () => {
  it("an entitled caller (active subscription) sees ONLY the verified+opted-in candidate", async () => {
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_search", {});
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.user_id);

    expect(ids, "the verified+opted-in candidate must appear").toContain(verifiedOptedIn.id);
    expect(
      ids,
      "PRIVACY BUG: a verified-but-NOT-opted-in seeker appeared in the directory",
    ).not.toContain(verifiedNotOptedIn.id);
    expect(
      ids,
      "PRIVACY BUG: an opted-in-but-NOT-verified seeker appeared in the directory",
    ).not.toContain(optedInNotVerified.id);
    expect(ids).not.toContain(neither.id);
  });

  it("a caller with NO active subscription (a real, lapsed row) sees NOTHING — not an error, an empty result", async () => {
    const { data, error } = await unsubscribedOrgOwner.client.rpc("talent_directory_search", {});
    expect(error).toBeNull();
    expect(
      data ?? [],
      "MONEY BUG: an org with a lapsed subscription could still search the directory for free",
    ).toEqual([]);
  });

  it("an outsider with no organisation at all sees NOTHING", async () => {
    const { data, error } = await outsider.client.rpc("talent_directory_search", {});
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("the p_candidate_id lookup used by the detail page obeys the SAME gates", async () => {
    // An entitled caller looking up the verified+opted-in candidate directly: found.
    const { data: found } = await subscribedOrgOwner.client.rpc("talent_directory_search", {
      p_candidate_id: verifiedOptedIn.id,
    });
    expect((found ?? []).map((r) => r.user_id)).toContain(verifiedOptedIn.id);

    // The SAME entitled caller looking up a non-qualifying candidate: nothing —
    // a guessed id for someone who never opted in must be indistinguishable
    // from one that doesn't exist.
    const { data: notFound } = await subscribedOrgOwner.client.rpc("talent_directory_search", {
      p_candidate_id: verifiedNotOptedIn.id,
    });
    expect(
      notFound ?? [],
      "PRIVACY BUG: a direct candidate-id lookup bypassed the opt-in gate",
    ).toEqual([]);

    // An UNENTITLED caller looking up the SAME real, qualifying candidate: nothing.
    const { data: unentitled } = await unsubscribedOrgOwner.client.rpc("talent_directory_search", {
      p_candidate_id: verifiedOptedIn.id,
    });
    expect(
      unentitled ?? [],
      "MONEY BUG: an unsubscribed org could look up a specific candidate by guessing their id",
    ).toEqual([]);
  });
});

describe("talent_directory_portfolio_items: same gates, independently", () => {
  it("an entitled caller reads the verified+opted-in candidate's items", async () => {
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_portfolio_items", {
      p_candidate_id: verifiedOptedIn.id,
    });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.title)).toContain("Verified & opted-in item");
  });

  it("PRIVACY: cannot read a verified-but-not-opted-in candidate's items, even with a real id", async () => {
    const { data } = await subscribedOrgOwner.client.rpc("talent_directory_portfolio_items", {
      p_candidate_id: verifiedNotOptedIn.id,
    });
    expect(data ?? []).toEqual([]);
  });

  it("PRIVACY: cannot read an opted-in-but-unverified candidate's items", async () => {
    const { data } = await subscribedOrgOwner.client.rpc("talent_directory_portfolio_items", {
      p_candidate_id: optedInNotVerified.id,
    });
    expect(data ?? []).toEqual([]);
  });

  it("MONEY: an unentitled caller cannot read ANY candidate's items, even a fully qualifying one", async () => {
    const { data } = await unsubscribedOrgOwner.client.rpc("talent_directory_portfolio_items", {
      p_candidate_id: verifiedOptedIn.id,
    });
    expect(data ?? []).toEqual([]);
  });
});

describe("no other query path leaks a non-opted-in seeker's data", () => {
  it("talent_portfolio_items itself stays owner-only RLS — an org owner cannot read it directly", async () => {
    const { data, error } = await subscribedOrgOwner.client
      .from("talent_portfolio_items")
      .select("id")
      .eq("user_id", verifiedOptedIn.id);
    expect(error).toBeNull();
    expect(
      data ?? [],
      "PRIVACY BUG: talent_portfolio_items has a direct SELECT path for non-owners",
    ).toEqual([]);
  });

  it("profiles' own RLS is untouched — an org owner cannot read another user's profile row directly", async () => {
    const { data, error } = await subscribedOrgOwner.client
      .from("profiles")
      .select("id")
      .eq("id", verifiedOptedIn.id);
    expect(error).toBeNull();
    expect(
      data ?? [],
      "PRIVACY BUG: profiles' RLS was widened for this feature instead of using the SECURITY DEFINER function",
    ).toEqual([]);
  });
});
