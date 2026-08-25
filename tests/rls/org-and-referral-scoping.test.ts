/**
 * RLS coverage for the two user-scoped tables the cross-user suite does not
 * reach — and the reason it does not reach them.
 *
 * `tests/rls/cross-user.test.ts` iterates OWNED_TABLES, which is every table
 * carrying a `user_id` column holding one user's private rows. Two tables tie
 * rows to users without fitting that shape, so the loop silently skipped both:
 *
 *   - `organization_members` — has `user_id`, but the row is a *grant*, not
 *     private data. The question is not "can B read A's row" but "can B create
 *     a row that gives B rights over someone else's organisation". Row-reading
 *     tests cannot see that class of bug at all.
 *   - `referrals` — user-scoped through `referrer_id`/`referred_user_id`, with
 *     no `user_id` column, so it was never a candidate for the loop.
 *
 * Both were in the schema before the RLS suite was written; neither was ever
 * covered. `organization_members` turned out to be genuinely broken (see
 * supabase/migrations/0026_fix_org_membership_rls.sql). `referrals` turned out
 * to be correct — worth a standing test either way, since "correct today" and
 * "correct after the next migration" are different claims.
 *
 * Environment note carries over from the cross-user suite: this runs against
 * the real project, creates namespaced throwaway users, and deletes them and
 * anything they touched in afterAll.
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
    throw new Error(
      `Org/referral RLS test cannot run: ${key} is not set. It must be present locally (.env.local) and as a CI secret — see .github/workflows/ci.yml.`,
    );
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
  const email = `rls-org-${label}-${randomUUID()}@talentrah.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr) throw createErr;

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

/** Outsider: belongs to no organisation, is party to no referral. */
let outsider: Awaited<ReturnType<typeof createAuthedUser>>;
/** The two parties to a real referral. */
let referrer: Awaited<ReturnType<typeof createAuthedUser>>;
let referred: Awaited<ReturnType<typeof createAuthedUser>>;

let orgId: string;
let orgDescription: string | null;
let internalPostingId: string;
let internalPostingTitle: string;
let referralId: string;

beforeAll(async () => {
  [outsider, referrer, referred] = await Promise.all([
    createAuthedUser("outsider"),
    createAuthedUser("referrer"),
    createAuthedUser("referred"),
  ]);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, description")
    .limit(1)
    .single();
  if (orgErr || !org) throw new Error("No organisation seeded — run `npm run seed` first.");
  orgId = org.id;
  orgDescription = org.description;

  const { data: posting, error: postErr } = await admin
    .from("job_postings")
    .select("id, title")
    .eq("organization_id", orgId)
    .eq("source_type", "internal")
    .limit(1)
    .single();
  if (postErr || !posting) {
    throw new Error("No internal posting seeded for that organisation — run `npm run seed` first.");
  }
  internalPostingId = posting.id;
  internalPostingTitle = posting.title;

  const { data: referral, error: refErr } = await admin
    .from("referrals")
    .insert({ referrer_id: referrer.id, referred_user_id: referred.id, status: "signed_up" })
    .select("id")
    .single();
  if (refErr) throw refErr;
  referralId = referral!.id;
});

afterAll(async () => {
  // Restore anything a failing assertion might have let through, so a red run
  // does not leave the demo data edited.
  await admin.from("organizations").update({ description: orgDescription }).eq("id", orgId);
  await admin.from("job_postings").update({ title: internalPostingTitle }).eq("id", internalPostingId);
  await admin.from("job_postings").delete().eq("title", "RLS-TEST-FORGED-POSTING");

  for (const u of [outsider, referrer, referred]) {
    if (!u) continue;
    await admin.from("organization_members").delete().eq("user_id", u.id);
    await admin.from("referrals").delete().eq("referrer_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
});

describe("RLS: organisation membership is a grant, not a self-service row", () => {
  it("an outsider cannot insert themselves into an organisation they did not create", async () => {
    // The bug this catches: the original policy checked only
    // `user_id = auth.uid()`, so this returned 201 and created a real
    // membership row — with a caller-chosen role of `owner`.
    await outsider.client
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: outsider.id, role: "owner" });

    // organization_members is keyed on (organization_id, user_id) — there is
    // no `id` column to select, and asking for one would fail this assertion
    // for the wrong reason.
    const { data, error } = await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("user_id", outsider.id)
      .eq("organization_id", orgId);

    expect(error, "the verification read itself failed — this test proved nothing").toBeNull();
    expect(
      data ?? [],
      `ESCALATION: any signed-in user could make themselves a member of an existing organisation (role granted: ${data?.[0]?.role ?? "none"})`,
    ).toHaveLength(0);
  });

  it("reading membership rows works at all — the policy is not self-recursive", async () => {
    // The bug this catches: the SELECT policy referenced its own table, so
    // this errored with "infinite recursion detected in policy" instead of
    // returning an empty set. A broken policy fails closed here, which looks
    // like safety and is not — every org-scoped policy that resolves
    // membership through this table failed the same way.
    const { error } = await outsider.client.from("organization_members").select("user_id");

    expect(
      error?.message ?? "",
      "the organization_members SELECT policy cannot evaluate — org-scoped authorisation is broken, not merely strict",
    ).not.toMatch(/infinite recursion/i);
  });

  it("an outsider cannot edit an organisation", async () => {
    await outsider.client
      .from("organizations")
      .update({ description: "RLS-TEST-EDIT" })
      .eq("id", orgId);

    const { data } = await admin
      .from("organizations")
      .select("description")
      .eq("id", orgId)
      .single();

    expect(data?.description, "LEAK: a non-member rewrote an organisation profile").toBe(
      orgDescription,
    );
  });

  it("an outsider cannot edit an organisation's job posting", async () => {
    await outsider.client
      .from("job_postings")
      .update({ title: "RLS-TEST-TITLE" })
      .eq("id", internalPostingId);

    const { data } = await admin
      .from("job_postings")
      .select("title")
      .eq("id", internalPostingId)
      .single();

    expect(data?.title, "LEAK: a non-member rewrote someone else's job posting").toBe(
      internalPostingTitle,
    );
  });

  it("an outsider cannot post a job under someone else's organisation", async () => {
    await outsider.client.from("job_postings").insert({
      source_type: "internal",
      organization_id: orgId,
      title: "RLS-TEST-FORGED-POSTING",
      company_name: "Should never exist",
      description: "Should never exist.",
      status: "open",
      dedup_fingerprint: `rls-test-${randomUUID()}`,
    });

    const { data } = await admin
      .from("job_postings")
      .select("id")
      .eq("title", "RLS-TEST-FORGED-POSTING");

    expect(data, "LEAK: a non-member published a job under another company's name").toHaveLength(0);
  });
});

describe("RLS: an unverified organisation cannot reach the public feed", () => {
  /*
   * The sibling of the 0026 escalation, and the reason "one policy is fixed"
   * is not "this class is closed".
   *
   * Creating an organisation is open to any authenticated user by design, and
   * after 0026 the creator can legitimately join it and post internal jobs
   * under it. Nothing gated those postings on `organizations.verified` — the
   * column exists, defaults to false, and was read by nothing — so an invented
   * "Paystack" could put a posting into every other user's feed.
   *
   * Reproduced against the live project before 0027 existed, all four steps
   * returning success. Fixed in 0027 at the RLS layer rather than in the feed
   * query, because the feed is only one of several readers.
   */
  it("a job posted under an unverified org is invisible to other users", async () => {
    const attacker = await createAuthedUser("unverified-org");
    const bystander = await createAuthedUser("bystander");
    const fingerprint = `rls-test-${randomUUID()}`;
    let attackerOrgId: string | undefined;

    try {
      const { data: org } = await attacker.client
        .from("organizations")
        .insert({ name: "RLS-TEST-Impersonated Co", created_by: attacker.id })
        .select("id, verified")
        .single();
      attackerOrgId = org!.id;
      expect(org!.verified, "a self-created org must not start out verified").toBe(false);

      await attacker.client
        .from("organization_members")
        .insert({ organization_id: attackerOrgId!, user_id: attacker.id, role: "owner" });

      await attacker.client.from("job_postings").insert({
        source_type: "internal",
        organization_id: attackerOrgId!,
        title: "RLS-TEST-UNVERIFIED-POSTING",
        company_name: "RLS-TEST-Impersonated Co",
        description: "Should never reach another user's feed.",
        status: "open",
        dedup_fingerprint: fingerprint,
      });

      // Exactly the feed's own query — src/app/(app)/jobs/page.tsx.
      const { data: seenByOther } = await bystander.client
        .from("job_postings")
        .select("*")
        .eq("status", "open")
        .eq("dedup_fingerprint", fingerprint);

      expect(
        seenByOther ?? [],
        "LEAK: anyone signed in could publish a job into every user's feed under a company name they invented",
      ).toHaveLength(0);

      // Positive control: the poster still sees their own draft, so this is a
      // visibility gate and not a write that silently failed.
      const { data: seenByOwner } = await attacker.client
        .from("job_postings")
        .select("id")
        .eq("dedup_fingerprint", fingerprint);
      expect(seenByOwner ?? [], "an org member should still see their own unverified posting").toHaveLength(1);
    } finally {
      await admin.from("job_postings").delete().eq("dedup_fingerprint", fingerprint);
      for (const u of [attacker, bystander]) {
        await admin.from("organization_members").delete().eq("user_id", u.id);
      }
      if (attackerOrgId) await admin.from("organizations").delete().eq("id", attackerOrgId);
      for (const u of [attacker, bystander]) await admin.auth.admin.deleteUser(u.id);
    }
  });

  it("the seeded verified org's postings stay in the feed", async () => {
    // The other half of the gate: 0027 must not hide legitimate internal jobs.
    // Zaria Digital is verified, and the golden-path e2e applies to one of its
    // postings — if this fails, that suite fails too.
    const outsiderSees = await outsider.client
      .from("job_postings")
      .select("id")
      .eq("id", internalPostingId);
    expect(outsiderSees.data ?? [], "a verified org's posting must stay publicly visible").toHaveLength(1);
  });
});

describe("RLS: the legitimate organisation path still works", () => {
  /*
   * Positive control for the whole block above. Every negative result there
   * would also be produced by policies that simply reject everyone — which is
   * precisely what the pre-0026 recursion bug did, and it looked like safety.
   * This proves the rules now evaluate and allow, not just crash and deny.
   */
  it("a user who creates an organisation can join it, then manage it", async () => {
    const founder = await createAuthedUser("founder");
    const ownOrgName = `RLS-TEST-ORG-${randomUUID()}`;
    let ownOrgId: string | undefined;

    try {
      const { data: created, error: createErr } = await founder.client
        .from("organizations")
        .insert({ name: ownOrgName, created_by: founder.id })
        .select("id")
        .single();
      expect(createErr, "a user should be able to create an organisation").toBeNull();
      ownOrgId = created!.id;

      const { error: joinErr } = await founder.client
        .from("organization_members")
        .insert({ organization_id: ownOrgId!, user_id: founder.id, role: "owner" });
      expect(joinErr, "the creator should be able to join the org they created").toBeNull();

      const { data: seen, error: readErr } = await founder.client
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", ownOrgId!);
      expect(readErr, "membership reads should evaluate, not error").toBeNull();
      expect(seen ?? [], "the creator should see their own membership row").toHaveLength(1);

      await founder.client
        .from("organizations")
        .update({ description: "RLS-TEST-OWN-EDIT" })
        .eq("id", ownOrgId!);
      const { data: org } = await admin
        .from("organizations")
        .select("description")
        .eq("id", ownOrgId!)
        .single();
      expect(org?.description, "a member should be able to edit their own organisation").toBe(
        "RLS-TEST-OWN-EDIT",
      );

      const fingerprint = `rls-test-${randomUUID()}`;
      const { error: postErr } = await founder.client.from("job_postings").insert({
        source_type: "internal",
        organization_id: ownOrgId!,
        title: "RLS-TEST-OWN-POSTING",
        company_name: ownOrgName,
        description: "Posted by a legitimate member.",
        status: "open",
        dedup_fingerprint: fingerprint,
      });
      expect(postErr, "a member should be able to post a job under their own org").toBeNull();
      await admin.from("job_postings").delete().eq("dedup_fingerprint", fingerprint);
    } finally {
      await admin.from("organization_members").delete().eq("user_id", founder.id);
      if (ownOrgId) await admin.from("organizations").delete().eq("id", ownOrgId);
      await admin.auth.admin.deleteUser(founder.id);
    }
  });
});

describe("RLS: referrals are visible to both parties and nobody else", () => {
  it("the referrer can read their own referral", async () => {
    // Positive control: without it, the negative results below would be
    // meaningless — a row nobody can see is not the same as a row protected
    // from the wrong people.
    const { data } = await referrer.client.from("referrals").select("id").eq("id", referralId);
    expect(data, "the referrer should see their own referral").toHaveLength(1);
  });

  it("the referred user can read the referral they are part of", async () => {
    const { data } = await referred.client.from("referrals").select("id").eq("id", referralId);
    expect(data, "the referred user should see the referral naming them").toHaveLength(1);
  });

  it("an outsider gets zero rows", async () => {
    const { data } = await outsider.client.from("referrals").select("*").eq("id", referralId);
    expect(data, "LEAK: a stranger read someone else's referral").toHaveLength(0);
  });

  it("an outsider cannot advance a referral to a rewarded state", async () => {
    await outsider.client.from("referrals").update({ status: "activated" }).eq("id", referralId);

    const { data } = await admin.from("referrals").select("status").eq("id", referralId).single();
    expect(data?.status, "LEAK: a stranger triggered someone else's referral reward").toBe(
      "signed_up",
    );
  });

  it("an outsider cannot delete a referral", async () => {
    await outsider.client.from("referrals").delete().eq("id", referralId);

    const { data } = await admin.from("referrals").select("id").eq("id", referralId);
    expect(data, "LEAK: a stranger deleted someone else's referral").toHaveLength(1);
  });

  it("nobody can forge a referral crediting themselves", async () => {
    // referrals has no INSERT policy by design — rewards are written by the
    // service role behind the activation trigger, never by a client.
    const { error } = await outsider.client
      .from("referrals")
      .insert({ referrer_id: outsider.id, referred_user_id: referrer.id, status: "activated" });

    expect(error, "LEAK: a user could mint referral credit for themselves").not.toBeNull();

    const { data } = await admin.from("referrals").select("id").eq("referrer_id", outsider.id);
    expect(data, "LEAK: a forged referral row was created").toHaveLength(0);
  });
});
