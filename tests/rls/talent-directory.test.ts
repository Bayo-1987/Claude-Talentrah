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
 *
 * 0137 adds the seeker-paid search boost (§6.13's third buyer segment) as a
 * pure ORDER BY change on top of that same gate — this suite's third
 * describe block proves the gate composes correctly with it: a boost record
 * must never be a THIRD way into the directory alongside verified+opted-in,
 * and among candidates who already pass the gate, a boost must actually
 * change ordering. Neither is assumed from "the WHERE clause is unchanged."
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
let boostedVerifiedOptedIn: { id: string; client: DB };

let subscribedOrgId: string;
let subscribedOrgOwner: { id: string; client: DB };
let unsubscribedOrgId: string;
let unsubscribedOrgOwner: { id: string; client: DB };
let outsider: { id: string; client: DB };

let subscriptionId: string;
let planId: string;

beforeAll(async () => {
  [verifiedOptedIn, verifiedNotOptedIn, optedInNotVerified, neither, boostedVerifiedOptedIn, subscribedOrgOwner, unsubscribedOrgOwner, outsider] =
    await Promise.all([
      createAuthedTestUser("tdrls-verified-optedin"),
      createAuthedTestUser("tdrls-verified-notoptedin"),
      createAuthedTestUser("tdrls-optedin-notverified"),
      createAuthedTestUser("tdrls-neither"),
      createAuthedTestUser("tdrls-boosted-verified-optedin"),
      createAuthedTestUser("tdrls-org-owner-sub"),
      createAuthedTestUser("tdrls-org-owner-nosub"),
      createAuthedTestUser("tdrls-outsider"),
    ]);

  const futureBoost = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

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
    // Verified AND opted-in AND boosted — the one candidate that should
    // actually be affected by 0137's ORDER BY change. Verified earlier than
    // `verifiedOptedIn` (see the `talent_verified_at` below) so that WITHOUT
    // the boost this candidate would sort strictly AFTER `verifiedOptedIn`
    // — the ordering assertion below only proves anything because of that.
    admin
      .from("profiles")
      .update({
        talent_verification_status: "verified",
        talent_directory_opt_in: true,
        talent_verified_at: new Date(Date.now() - 3600_000).toISOString(),
        talent_boosted_until: futureBoost,
      })
      .eq("id", boostedVerifiedOptedIn.id),
  ]);

  // A "boost record" on candidates that fail the verified+opted-in gate —
  // proving 0137's own claim that a boost is never a third way in. Setting
  // `talent_boosted_until` directly (rather than going through the purchase
  // flow) is deliberate: this must hold even for a row that "somehow" has a
  // boost value, not just one that arrived via the normal, gated purchase
  // path.
  await Promise.all([
    admin.from("profiles").update({ talent_boosted_until: futureBoost }).eq("id", verifiedNotOptedIn.id),
    admin.from("profiles").update({ talent_boosted_until: futureBoost }).eq("id", optedInNotVerified.id),
    admin.from("profiles").update({ talent_boosted_until: futureBoost }).eq("id", neither.id),
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
    boostedVerifiedOptedIn.id,
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

/**
 * 0150's own standing check: talent_directory_plans and
 * talent_directory_subscriptions have never had INSERT/UPDATE/DELETE
 * revoked from `authenticated` since 0135 created them — only their own
 * SELECT policies existed. Both tables are purely service-role-written
 * (the plan catalog is an admin-managed table; a subscription purchase goes
 * through Paystack fulfilment), so there is no legitimate column list to
 * re-grant, unlike profiles/mentor_profiles's partial revokes. CLAUDE.md's
 * own column-privilege lesson, applied here directly — proving the GRANT is
 * gone, not just that no policy happens to permit it today.
 */
describe("0150: talent_directory_plans/subscriptions have NO direct client write path, at the grant level", () => {
  it("an org owner cannot insert a fabricated plan directly", async () => {
    const { error } = await subscribedOrgOwner.client
      .from("talent_directory_plans")
      .insert({ name: "Free Plan", price_ngn: 0, is_active: true });
    expect(
      error?.code,
      "GRANT BUG: a direct client INSERT into talent_directory_plans was not refused at the grant level",
    ).toBe("42501");
  });

  it("an org owner cannot update the plan catalog's price directly", async () => {
    const { error } = await subscribedOrgOwner.client
      .from("talent_directory_plans")
      .update({ price_ngn: 0 })
      .eq("id", planId);
    expect(
      error?.code,
      "MONEY BUG: a direct client UPDATE on talent_directory_plans' price was not refused at the grant level",
    ).toBe("42501");
  });

  it("an org owner cannot insert a fabricated subscription for their own org directly", async () => {
    const { error } = await subscribedOrgOwner.client.from("talent_directory_subscriptions").insert({
      organization_id: subscribedOrgId,
      plan_id: planId,
      expires_at: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      status: "active",
    });
    expect(
      error?.code,
      "MONEY BUG: a direct client INSERT into talent_directory_subscriptions was not refused at the grant level",
    ).toBe("42501");
  });

  it("an org owner cannot extend their own subscription's expiry directly", async () => {
    const { error } = await subscribedOrgOwner.client
      .from("talent_directory_subscriptions")
      .update({ expires_at: new Date(Date.now() + 365 * 24 * 3600_000).toISOString() })
      .eq("id", subscriptionId);
    expect(
      error?.code,
      "MONEY BUG: a direct client UPDATE on talent_directory_subscriptions' expiry was not refused at the grant level",
    ).toBe("42501");

    const { data: unchanged } = await admin
      .from("talent_directory_subscriptions")
      .select("expires_at")
      .eq("id", subscriptionId)
      .single();
    expect(unchanged?.expires_at, "the subscription's real expiry must survive an attempted client-side extension").not.toBeNull();
  });

  it("an unsubscribed org owner cannot delete another org's subscription directly", async () => {
    const { error } = await unsubscribedOrgOwner.client
      .from("talent_directory_subscriptions")
      .delete()
      .eq("id", subscriptionId);
    expect(
      error?.code,
      "GRANT BUG: a direct client DELETE on talent_directory_subscriptions was not refused at the grant level",
    ).toBe("42501");

    const { data: stillThere } = await admin
      .from("talent_directory_subscriptions")
      .select("id")
      .eq("id", subscriptionId)
      .maybeSingle();
    expect(stillThere?.id, "the subscription row must survive an attempted client-side delete").toBe(subscriptionId);
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

describe("0137: the seeker-paid search boost never overrides the verified+opted-in gate", () => {
  it("PRIVACY BUG: a boost record must not let an opted-out-but-verified seeker into the directory", async () => {
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_search", {
      p_candidate_id: verifiedNotOptedIn.id,
    });
    expect(error).toBeNull();
    expect(
      data ?? [],
      "PRIVACY BUG: a talent_boosted_until value let a verified-but-NOT-opted-in seeker appear in the directory",
    ).toEqual([]);
  });

  it("PRIVACY BUG: a boost record must not let an unverified-but-opted-in seeker into the directory", async () => {
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_search", {
      p_candidate_id: optedInNotVerified.id,
    });
    expect(error).toBeNull();
    expect(
      data ?? [],
      "PRIVACY BUG: a talent_boosted_until value let an opted-in-but-NOT-verified seeker appear in the directory",
    ).toEqual([]);
  });

  it("PRIVACY BUG: a boost record must not let a seeker who is neither verified nor opted-in into the directory", async () => {
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_search", {
      p_candidate_id: neither.id,
    });
    expect(error).toBeNull();
    expect(
      data ?? [],
      "PRIVACY BUG: a talent_boosted_until value alone (no verification, no opt-in) exposed a seeker in the directory",
    ).toEqual([]);
  });

  it("the SAME three boosted-but-ineligible candidates are also absent from a plain, unfiltered search", async () => {
    // The p_candidate_id lookup above proves each one individually; this
    // proves the boost doesn't smuggle them into the general result set
    // either — e.g. via the ORDER BY somehow short-circuiting the WHERE.
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_search", { p_limit: 50 });
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.user_id);
    expect(ids).not.toContain(verifiedNotOptedIn.id);
    expect(ids).not.toContain(optedInNotVerified.id);
    expect(ids).not.toContain(neither.id);
  });

  it("among candidates who DO pass the gate, a boost genuinely moves a candidate ahead in ordering", async () => {
    const { data, error } = await subscribedOrgOwner.client.rpc("talent_directory_search", { p_limit: 50 });
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.user_id);

    const boostedIndex = ids.indexOf(boostedVerifiedOptedIn.id);
    const unboostedIndex = ids.indexOf(verifiedOptedIn.id);
    expect(boostedIndex, "the boosted candidate must appear in results at all").toBeGreaterThanOrEqual(0);
    expect(unboostedIndex, "the unboosted candidate must still appear in results").toBeGreaterThanOrEqual(0);
    expect(
      boostedIndex,
      "a boosted candidate (verified earlier, so it would otherwise sort LAST) must sort ahead of an unboosted one",
    ).toBeLessThan(unboostedIndex);
  });
});
