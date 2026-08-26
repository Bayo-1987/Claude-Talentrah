/**
 * Column-privilege regression suite — the standing check for the class of bug
 * that 0028 and 0030 fixed.
 *
 * THE CLASS, stated once: RLS row policies decide WHICH ROWS you may touch.
 * They say nothing about WHICH COLUMNS. Supabase grants `ALL ON ALL TABLES` to
 * `authenticated` by default, so any table with a permissive UPDATE policy lets
 * the owner rewrite *every* column on their own row — including the ones that
 * represent trust, money, or identity, which were never meant to be theirs to
 * set. The row being yours does not make every column on it yours.
 *
 * This surface has now produced four live findings in a row (0026, 0027, 0028,
 * 0030), each found only when something finally exercised it. A per-column
 * assertion is the cheapest way to stop the fifth being found the same way:
 * add a value-bearing column to a user-writable table and this fails until you
 * decide, deliberately, which side of the line it is on.
 *
 * Note what a passing test here means. It asserts the PRIVILEGE, not the
 * policy — the two are separate mechanisms and only one of them was ever
 * being checked before 0028. Both the "refused" and "unchanged" assertions
 * matter: a column-level denial raises an error, while a row-policy denial
 * silently affects zero rows, and only re-reading with the service role tells
 * those apart from success.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) throw new Error(`Column-privilege test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createAuthedUser(label: string) {
  const email = `colpriv-${label}-${randomUUID()}@talentrah.test`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
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

let user: Awaited<ReturnType<typeof createAuthedUser>>;
let fixtureOrgId: string | null = null;
/** A posting this suite owns — see makeFixturePosting. */
let fixtureJobId: string;

beforeAll(async () => {
  user = await createAuthedUser("owner");

  /*
   * A posting this suite OWNS.
   *
   * Three tests below took whatever `job_postings` returned first for
   * `status = open` and inserted against it. With up to 33 files in parallel
   * against one production project, a borrowed row can be deleted by its owning
   * suite between the hook and the test.
   *
   * MEASURED, because the intuitive reading is wrong: for the two NEGATIVE
   * tests here (which assert an insert is refused) a deleted posting is
   * harmless — pointing the insert at a nonexistent uuid still yields 42501,
   * because Postgres evaluates the column-grant denial BEFORE the foreign key.
   * They were never silently losing coverage. It is the third test, which
   * inserts through the service role and EXPECTS success, that a deleted row
   * would break — loudly, with 23503.
   *
   * Owning the posting fixes the third and costs nothing for the other two.
   */
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: `COLPRIV-TEST Org ${randomUUID().slice(0, 8)}`,
      domain: `colpriv-${randomUUID().slice(0, 8)}.example`,
      created_by: user.id,
      verified: true,
    })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`Could not create fixture org: ${orgError?.message}`);
  fixtureOrgId = org.id;

  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: fixtureOrgId,
      company_name: "COLPRIV-TEST Co",
      title: "COLPRIV-TEST Role",
      description: "Fixture posting owned by tests/rls/column-privileges.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`Could not create fixture posting: ${jobError?.message}`);
  fixtureJobId = job.id;
});

afterAll(async () => {
  if (user) await admin.auth.admin.deleteUser(user.id);
  if (fixtureOrgId) await deleteOrgsCascade(admin, [fixtureOrgId]);
});

describe("profiles: a user cannot rewrite what their account is worth (0030)", () => {
  /**
   * `credits_balance` is the one that costs money. src/lib/credits/spend.ts
   * reads it as the authoritative balance before every paid AI action, so a
   * writable balance is unlimited model spend from a single PATCH. Measured
   * exposed before 0030; refused after.
   */
  it("cannot grant itself credits", async () => {
    const { error } = await user.client
      .from("profiles")
      .update({ credits_balance: 999_999 })
      .eq("id", user.id);

    const { data } = await admin
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .single();

    expect(
      data?.credits_balance,
      "MONEY: a user set their own credit balance and can now spend it on real model calls",
    ).not.toBe(999_999);
    expect(error, "should be refused at the privilege layer, not silently dropped").not.toBeNull();
  });

  it("cannot restore a spent free trial", async () => {
    await admin.from("profiles").update({ free_trial_tailoring_used: true }).eq("id", user.id);
    await user.client
      .from("profiles")
      .update({ free_trial_tailoring_used: false })
      .eq("id", user.id);

    const { data } = await admin
      .from("profiles")
      .select("free_trial_tailoring_used")
      .eq("id", user.id)
      .single();
    expect(data?.free_trial_tailoring_used, "a one-time free trial became renewable").toBe(true);
  });

  it("cannot rewrite the referral graph", async () => {
    // referral_code is this account's identity in the referral funnel;
    // referred_by retroactively attributes it to a referrer of your choosing.
    const other = await createAuthedUser("other");
    try {
      await user.client.from("profiles").update({ referral_code: "HACKED99" }).eq("id", user.id);
      await user.client.from("profiles").update({ referred_by: other.id }).eq("id", user.id);

      const { data } = await admin
        .from("profiles")
        .select("referral_code, referred_by")
        .eq("id", user.id)
        .single();
      expect(data?.referral_code).not.toBe("HACKED99");
      expect(data?.referred_by).toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(other.id);
    }
  });

  it("cannot change the email its identity is keyed on", async () => {
    await user.client
      .from("profiles")
      .update({ email: "attacker@example.com" })
      .eq("id", user.id);
    const { data } = await admin.from("profiles").select("email").eq("id", user.id).single();
    expect(data?.email).not.toBe("attacker@example.com");
  });

  it("cannot self-select a billing segment", async () => {
    // Inert today; it is what Phase 2 prices against. Locked before it matters
    // rather than after, which is the whole lesson of this migration series.
    await user.client.from("profiles").update({ market_segment: "diaspora" }).eq("id", user.id);
    const { data } = await admin
      .from("profiles")
      .select("market_segment")
      .eq("id", user.id)
      .single();
    expect(data?.market_segment).toBe("home");
  });

  it("POSITIVE CONTROL: can still edit its own personal details", async () => {
    // Without this, every assertion above is satisfied by a table nobody can
    // write at all — which would be a broken Settings screen, not a fix.
    const { error } = await user.client
      .from("profiles")
      .update({ first_name: "Ada", last_name: "Nwosu", country: "Nigeria" })
      .eq("id", user.id);
    expect(error, "0030 must not have locked users out of their own name").toBeNull();

    const { data } = await admin
      .from("profiles")
      .select("first_name, country")
      .eq("id", user.id)
      .single();
    expect(data?.first_name).toBe("Ada");
    expect(data?.country).toBe("Nigeria");
  });
});

describe("organizations: a company cannot verify itself (0028)", () => {
  it("cannot set verified, but can still edit its profile", async () => {
    const { data: org } = await user.client
      .from("organizations")
      .insert({ name: `COLPRIV-TEST ${randomUUID().slice(0, 8)}`, created_by: user.id })
      .select("id")
      .single();
    try {
      await user.client.from("organization_members").insert({
        organization_id: org!.id,
        user_id: user.id,
        role: "owner",
      });

      await user.client.from("organizations").update({ verified: true }).eq("id", org!.id);
      const { data: after } = await admin
        .from("organizations")
        .select("verified")
        .eq("id", org!.id)
        .single();
      expect(after?.verified, "an organisation verified itself past the 0027 feed gate").toBe(
        false,
      );

      const { error } = await user.client
        .from("organizations")
        .update({ description: "legitimate edit" })
        .eq("id", org!.id);
      expect(error, "employers must still be able to edit their own profile").toBeNull();
    } finally {
      await deleteTestOrgs([org!.id]);
    }
  });
});

describe("tables with no UPDATE policy stay unwritable", () => {
  /**
   * These carry money, entitlements and role grants, and none of them has an
   * UPDATE policy — RLS denies before column privileges are even consulted.
   * Asserted anyway: "there is no policy" is one careless migration away from
   * being false, and these are the rows where that would cost the most.
   *
   * A row-policy denial returns success with zero rows affected, so each case
   * re-reads with the service role. "No error" would be a false pass.
   */
  it("credit_ledger, payment_transactions, user_passes, referrals and roles are all read-only to their owner", async () => {
    const { data: passCatalog } = await admin.from("passes").select("id").limit(1).single();

    const { data: ledger } = await admin
      .from("credit_ledger")
      .insert({ user_id: user.id, delta: 5, reason: "admin_adjustment", balance_after: 5 })
      .select("id")
      .single();
    const { data: tx } = await admin
      .from("payment_transactions")
      .insert({
        user_id: user.id,
        amount: 250_000,
        product_type: "credit_pack",
        product_id: passCatalog!.id,
        status: "pending",
        paystack_reference: `colpriv-${randomUUID()}`,
      })
      .select("id")
      .single();
    const { data: pass } = await admin
      .from("user_passes")
      .insert({
        user_id: user.id,
        pass_id: passCatalog!.id,
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
        payment_method: "card",
        status: "expired",
      })
      .select("id")
      .single();

    try {
      await user.client.from("credit_ledger").update({ delta: 99_999 }).eq("id", ledger!.id);
      await user.client.from("payment_transactions").update({ status: "success" }).eq("id", tx!.id);
      await user.client
        .from("user_passes")
        .update({ status: "active", expires_at: new Date(Date.now() + 86_400_000).toISOString() })
        .eq("id", pass!.id);

      const [{ data: l }, { data: t }, { data: p }] = await Promise.all([
        admin.from("credit_ledger").select("delta").eq("id", ledger!.id).single(),
        admin.from("payment_transactions").select("status").eq("id", tx!.id).single(),
        admin.from("user_passes").select("status").eq("id", pass!.id).single(),
      ]);

      expect(l?.delta, "MONEY: a user rewrote their own credit ledger entry").toBe(5);
      expect(t?.status, "MONEY: a user marked their own payment successful").toBe("pending");
      expect(p?.status, "a user reactivated their own expired pass").toBe("expired");
    } finally {
      await admin.from("credit_ledger").delete().eq("id", ledger!.id);
      await admin.from("payment_transactions").delete().eq("id", tx!.id);
      await admin.from("user_passes").delete().eq("id", pass!.id);
    }
  });

  it("an org member cannot promote their own role after joining", async () => {
    // 0026 fixed self-granted ownership at INSERT. This is the other half:
    // there must be no UPDATE path that promotes a row after the fact.
    const { data: org } = await user.client
      .from("organizations")
      .insert({ name: `COLPRIV-ROLE ${randomUUID().slice(0, 8)}`, created_by: user.id })
      .select("id")
      .single();
    try {
      await user.client
        .from("organization_members")
        .insert({ organization_id: org!.id, user_id: user.id, role: "admin" });

      await user.client
        .from("organization_members")
        .update({ role: "owner" })
        .eq("organization_id", org!.id)
        .eq("user_id", user.id);

      const { data } = await admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", org!.id)
        .eq("user_id", user.id)
        .single();
      expect(data?.role, "ESCALATION: a member promoted themselves to owner after joining").toBe(
        "admin",
      );
    } finally {
      await deleteTestOrgs([org!.id]);
    }
  });
});

describe("derived tables are the server's conclusion, not the user's input (0031)", () => {
  it("a user cannot write their own match score, but can still read it", async () => {
    /*
     * Cosmetic today — only their own feed ordering reads it. It stops being
     * cosmetic when Auto-Apply ships: build-prompt §6.2 gates it on a match
     * threshold, so a user-writable score is a user-writable trigger for
     * applications sent under their name.
     */
    const { error: insertError } = await user.client
      .from("match_scores")
      .insert({ user_id: user.id, job_posting_id: fixtureJobId, score: 100, tier: "Excellent" });
    expect(insertError, "a user authored their own match score").not.toBeNull();
    // The CODE, not merely that something failed. `.not.toBeNull()` alone is
    // satisfied by any error at all, so it would keep passing if the refusal
    // ever stopped being a permission denial and became something incidental.
    // (A missing posting is NOT such a case — see the note in beforeAll.)
    expect(
      insertError!.code,
      `expected a permission denial, got ${insertError!.code}: ${insertError!.message}`,
    ).toBe("42501");

    const { data: rows } = await admin
      .from("match_scores")
      .select("id")
      .eq("user_id", user.id)
      .eq("job_posting_id", fixtureJobId);
    expect(rows ?? []).toHaveLength(0);

    const { error: readError } = await user.client
      .from("match_scores")
      .select("id")
      .eq("user_id", user.id);
    expect(readError, "users must still be able to read their own scores").toBeNull();
  });

  it("a user cannot fabricate their own tailoring history", async () => {
    // Traced before locking: nothing reads is_free_trial or credits_spent back
    // — eligibility comes from profiles, which 0030 locked. So this is a log,
    // and a log its subject can rewrite is not evidence.
    const { error } = await user.client
      .from("job_tailoring_requests")
      .insert({ user_id: user.id, source_jd_text: "fabricated", is_free_trial: true, credits_spent: 0 });
    expect(error, "a user wrote their own tailoring log entry").not.toBeNull();

    const { error: readError } = await user.client
      .from("job_tailoring_requests")
      .select("id")
      .eq("user_id", user.id);
    expect(readError, "users must still be able to read their own tailoring history").toBeNull();
  });
});

describe("signed-out reach (0032)", () => {
  const anonClient: DB = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it("REGRESSION GUARD: a signed-out visitor can read the public job board", async () => {
    /*
     * This is the test that would have caught 0027.
     *
     * 0027 revoked is_org_member from anon as tidy-up, but its own
     * "job postings are publicly readable" policy calls that function and has
     * no TO clause — so it applies to anon, which then could not execute it.
     * Result: a table RLS declares publicly readable returned
     * "permission denied for function is_org_member" to the public. Nothing
     * user-facing broke only because the landing page's job preview is
     * hardcoded sample copy. Restored in 0032.
     *
     * Asserting on the ERROR, not just the row count: a policy that silently
     * returns zero rows and one that errors outright are different failures,
     * and only the second one was happening.
     */
    const { data, error } = await anonClient.from("job_postings").select("id").limit(5);
    expect(error, "the public job board errors for the public").toBeNull();
    expect((data ?? []).length, "a signed-out visitor should see external postings").toBeGreaterThan(0);
  });

  it("but still cannot see an unverified company's postings", async () => {
    // The 0032 fix must not have re-opened 0027's gate.
    const { data: internal } = await anonClient
      .from("job_postings")
      .select("organization_id")
      .eq("source_type", "internal");
    const orgIds = [...new Set((internal ?? []).map((r) => r.organization_id).filter(Boolean))] as string[];
    if (orgIds.length > 0) {
      const { data: orgs } = await admin.from("organizations").select("verified").in("id", orgIds);
      expect(
        (orgs ?? []).every((o) => o.verified),
        "LEAK: a signed-out visitor saw an unverified company's job",
      ).toBe(true);
    }
  });

  it("sees nothing on any owner-scoped table", async () => {
    for (const table of [
      "profiles",
      "resumes",
      "applications",
      "credit_ledger",
      "payment_transactions",
      "user_passes",
      "referrals",
      "farah_messages",
      "match_scores",
    ] as const) {
      const { data } = await anonClient.from(table).select("*").limit(1);
      expect(data ?? [], `LEAK: anon read ${table}`).toHaveLength(0);
    }
  });

  it("cannot call generate_referral_code", async () => {
    // The last function still carrying Supabase's default PUBLIC grant. It
    // leaks nothing, but it is an unauthenticated endpoint that loops over a
    // query, and nothing in the app calls it.
    const { error } = await anonClient.rpc("generate_referral_code");
    expect(error, "an unauthenticated caller could run a database loop on demand").not.toBeNull();
  });

  it("POSITIVE CONTROL: the public catalogs stay public", async () => {
    // Pricing and templates are meant to be readable before signup.
    for (const table of ["credit_packs", "passes", "resume_templates"] as const) {
      const { data, error } = await anonClient.from(table).select("id").limit(1);
      expect(error, `${table} should be publicly readable`).toBeNull();
      expect((data ?? []).length, `${table} returned nothing to the public`).toBeGreaterThan(0);
    }
  });
});

describe("auto-apply tables: the user owns the switch, the server owns the rest (0033)", () => {
  it("a user can create their settings row and flip `enabled` on it", async () => {
    /*
     * POSITIVE CONTROL: `enabled` is the one Auto-Apply value that is genuinely
     * the user's, and locking it would break the feature.
     *
     * Written as insert-then-update rather than an upsert on purpose, and the
     * distinction is worth recording. `upsert({ user_id, enabled })` fails with
     * 42501 here, because ON CONFLICT DO UPDATE sets every column in the
     * payload — including the primary key — and 0033 grants UPDATE on
     * (enabled, updated_at) only. That is the grant behaving exactly as
     * intended; it is the upsert asking for more than it needs. The production
     * toggle goes through the service role and is unaffected.
     */
    const { error: insertError } = await user.client
      .from("auto_apply_settings")
      .insert({ user_id: user.id, enabled: false });
    expect(insertError, "a user must be able to create their own settings row").toBeNull();

    const { error: updateError } = await user.client
      .from("auto_apply_settings")
      .update({ enabled: true })
      .eq("user_id", user.id);
    expect(updateError, "a user must be able to turn their own Auto-Apply on").toBeNull();

    const { data } = await admin
      .from("auto_apply_settings")
      .select("enabled")
      .eq("user_id", user.id)
      .single();
    expect(data?.enabled).toBe(true);
  });

  it("but cannot backdate when it was switched on", async () => {
    // `enabled_at` is a server observation, not a field — it is what a support
    // question about an unexpected application reads to establish "since when".
    const forged = "2020-01-01T00:00:00.000Z";
    await user.client
      .from("auto_apply_settings")
      .update({ enabled_at: forged })
      .eq("user_id", user.id);
    const { data } = await admin
      .from("auto_apply_settings")
      .select("enabled_at")
      .eq("user_id", user.id)
      .single();
    expect(data?.enabled_at).not.toBe(forged);
  });

  it("cannot forge the queue that decides what gets applied to", async () => {
    /*
     * The queue is the instruction list for applications sent under the user's
     * name. If a user can write it, the match threshold is decorative — queue
     * anything, at any score, and confirm it.
     */
    const { error } = await user.client.from("auto_apply_queue").insert({
      user_id: user.id,
      job_posting_id: fixtureJobId,
      match_score: 100,
      tier: "excellent",
      source_type: "internal",
    });
    expect(error, "a user queued their own Auto-Apply candidate").not.toBeNull();

    const { data: rows } = await admin
      .from("auto_apply_queue")
      .select("id")
      .eq("user_id", user.id);
    expect(rows ?? []).toHaveLength(0);
  });

  it("cannot rewrite what the activity log says happened", async () => {
    // The log is the record of applications sent on their behalf and credits
    // charged. Editable history is not an audit trail (build-prompt §8).
    const { data: row } = await admin
      .from("auto_apply_queue")
      .insert({
        user_id: user.id,
        job_posting_id: fixtureJobId,
        match_score: 95,
        tier: "excellent",
        // The fixture posting is internal by construction.
        source_type: "internal",
        status: "submitted",
        decided_at: new Date().toISOString(),
        credits_spent: 2,
      })
      .select("id")
      .single();

    try {
      await user.client
        .from("auto_apply_queue")
        .update({ status: "dismissed", credits_spent: 0 })
        .eq("id", row!.id);

      const { data: after } = await admin
        .from("auto_apply_queue")
        .select("status, credits_spent")
        .eq("id", row!.id)
        .single();
      expect(after?.status, "a user edited their own Auto-Apply history").toBe("submitted");
      expect(after?.credits_spent, "a user zeroed a recorded credit charge").toBe(2);
    } finally {
      await admin.from("auto_apply_queue").delete().eq("id", row!.id);
    }
  });
});

describe("resumes: the premium-template paywall is not the user's to set (0041)", () => {
  /**
   * The fifth finding in this class, and the one the suite's own header
   * predicted: "add a value-bearing column to a user-writable table and this
   * fails until you decide, deliberately, which side of the line it is on."
   * `resumes` was never swept. Its policy is
   *
   *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
   *
   * — correctly ownership-scoped, and silent about columns. `template_id`
   * points at `resume_templates`, where `is_premium` rows cost credits through
   * `unlockTemplateAction`. That action checks `user_template_unlocks` and
   * calls `spendCredits`. None of it is reachable by a client that simply
   * writes the column.
   *
   * CONFIRMED LIVE before the fix, with a real authenticated session against
   * the production project — not reasoned from the schema:
   *
   *     premium template: Portfolio Grid (costs 10 credits)
   *     unlocks owned: 0   credits: 0
   *     update error: none
   *     template_id now: 7704054a-6c90-40b6-a977-ef6e2e1c404f
   *     => BYPASSED — premium template applied, 0 credits spent
   *     credits after: 0 (unchanged = never paid)
   *
   * A user with no credits and no unlocks applied a paid template. Every
   * premium template was free to anyone who opened the network tab.
   */
  let resumeId: string;
  let premiumTemplateId: string;

  beforeAll(async () => {
    const { data: premium, error } = await admin
      .from("resume_templates")
      .select("id")
      .eq("is_premium", true)
      .limit(1)
      .single();
    if (error || !premium) throw new Error("No premium template seeded — run `npm run seed`.");
    premiumTemplateId = premium.id;

    const { data: resume, error: insErr } = await admin
      .from("resumes")
      .insert({
        user_id: user.id,
        is_base: false,
        title: "column-privilege fixture",
        source: "builder",
        structured_content: {},
        template_id: null,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    resumeId = resume.id;
  });

  it("MONEY: cannot apply a premium template by writing template_id directly", async () => {
    const { error } = await user.client
      .from("resumes")
      .update({ template_id: premiumTemplateId })
      .eq("id", resumeId);

    expect(error, "the column-level grant should refuse this outright").not.toBeNull();

    // Re-read with the service role: a column denial errors, but a row-policy
    // denial silently affects zero rows, and only this tells them apart.
    const { data } = await admin.from("resumes").select("template_id").eq("id", resumeId).single();
    expect(
      data?.template_id,
      "PAYWALL BYPASS: a premium template was applied without an unlock or a credit spend",
    ).toBeNull();

    // And no unlock or ledger entry was fabricated on the way.
    const { data: unlocks } = await admin
      .from("user_template_unlocks")
      .select("id")
      .eq("user_id", user.id);
    expect(unlocks ?? []).toHaveLength(0);
  });

  it("cannot reassign a resume to another user, or promote it to the base resume", async () => {
    // The other trust/identity columns on the same row. `is_base` decides
    // which resume every tailoring and auto-apply path reads.
    for (const patch of [{ is_base: true }, { user_id: randomUUID() }]) {
      const { error } = await user.client.from("resumes").update(patch).eq("id", resumeId);
      expect(error, `writing ${Object.keys(patch)[0]} should be refused`).not.toBeNull();
    }

    const { data } = await admin
      .from("resumes")
      .select("is_base, user_id")
      .eq("id", resumeId)
      .single();
    expect(data?.is_base).toBe(false);
    expect(data?.user_id).toBe(user.id);
  });

  it("POSITIVE CONTROL: the real save path still works", async () => {
    /*
     * Load-bearing. A fix that also breaks saveResumeAction is worse than the
     * bug — the builder's save would fail for every user. These are exactly
     * the columns src/lib/resume-builder/actions.ts:137 and
     * src/lib/resume/upsert-base-resume.ts write, and they must stay writable.
     */
    const { error } = await user.client
      .from("resumes")
      .update({
        title: "renamed by the owner",
        structured_content: { summary: "edited" },
        source: "builder",
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId);

    expect(error, "the legitimate save path must not be collateral damage").toBeNull();

    const { data } = await admin
      .from("resumes")
      .select("title, structured_content")
      .eq("id", resumeId)
      .single();
    expect(data?.title).toBe("renamed by the owner");
    expect(data?.structured_content).toEqual({ summary: "edited" });
  });
});

describe("farah_messages: the LLM rate limit is not the user's to reset (0041)", () => {
  /**
   * Found by the "what else grants the same privilege" sweep that CLAUDE.md
   * makes standard after a policy fix — `resumes` was the reported bug, this
   * was next to it.
   *
   * /api/farah/chat caps a user at 30 messages an hour purely as a cost
   * safety net on unbounded authenticated LLM spend. It counts its own rows:
   *
   *     .eq("user_id", user.id).eq("role", "user").gte("created_at", oneHourAgo)
   *
   * Both `role` and `created_at` sat inside an owner-only `FOR ALL` policy
   * with no column grant, so the counter was writable by the thing being
   * counted. CONFIRMED LIVE before the fix:
   *
   *     counted toward the 30/hr cap: 1
   *     backdate error: none
   *     counted after backdating: 0
   *     => BYPASSED — quota reset, unlimited paid LLM calls
   *
   * Nothing in src/ ever UPDATEs this table, so the grant is revoked outright
   * rather than narrowed — same reasoning as 0031's derived tables.
   */
  beforeAll(async () => {
    await admin.from("farah_messages").insert({ user_id: user.id, role: "user", content: "hi" });
  });

  it("COST: cannot backdate its own messages to clear the hourly quota", async () => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const countNow = async () =>
      (
        await admin
          .from("farah_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("role", "user")
          .gte("created_at", hourAgo)
      ).count ?? 0;

    expect(await countNow(), "fixture message should be inside the window").toBeGreaterThan(0);

    const { error } = await user.client
      .from("farah_messages")
      .update({ created_at: "2020-01-01T00:00:00.000Z" })
      .eq("user_id", user.id);
    expect(error, "backdating should be refused").not.toBeNull();

    expect(
      await countNow(),
      "RATE-LIMIT BYPASS: the user cleared their own quota and can spend unbounded LLM budget",
    ).toBeGreaterThan(0);
  });

  it("cannot relabel its own messages as Farah's to duck the counter", async () => {
    // `farah`, the real enum value — not a made-up one. An invalid enum would
    // be rejected by the type check rather than the grant, and would pass this
    // test for entirely the wrong reason.
    const { error } = await user.client
      .from("farah_messages")
      .update({ role: "farah" })
      .eq("user_id", user.id);
    expect(error).not.toBeNull();

    const { data } = await admin
      .from("farah_messages")
      .select("role")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    expect(data?.role).toBe("user");
  });
});

describe("resume_templates is catalog data, not user input (0042)", () => {
  /**
   * Added alongside the template library, which put a new column (`slug`) on
   * this table. The concern was reasonable — 0028/0030/0031/0041 are all the
   * same story of a new column landing on a user-writable table — so this
   * records the answer as a standing check instead of a one-off observation.
   *
   * `resume_templates` is different in kind from those tables: it is a catalog
   * every user READS and nobody owns. It has RLS enabled with exactly one
   * policy, `SELECT`, and no write policy at all. That means the row policy
   * refuses a write before the table-wide grant is ever consulted — the
   * opposite arrangement to `resumes`, where a permissive `FOR ALL` policy let
   * the default grant through.
   *
   * `is_premium` and `unlock_cost_credits` are the money columns here. If a
   * write policy is ever added to this table, these assertions fail, which is
   * the point.
   */
  it("an authenticated user cannot rewrite the catalog's price or its slugs", async () => {
    const { data: template } = await admin
      .from("resume_templates")
      .select("id, slug, is_premium, unlock_cost_credits")
      .eq("is_premium", true)
      .limit(1)
      .single();
    if (!template) throw new Error("No premium template seeded — run `npm run seed`.");

    for (const patch of [
      { is_premium: false },
      { unlock_cost_credits: 0 },
      { slug: "hijacked-slug" },
    ]) {
      const { error } = await user.client
        .from("resume_templates")
        .update(patch)
        .eq("id", template.id);
      // A row-policy denial silently affects zero rows rather than erroring,
      // so the re-read below is what actually proves it, not this.
      void error;
    }

    const { data: after } = await admin
      .from("resume_templates")
      .select("slug, is_premium, unlock_cost_credits")
      .eq("id", template.id)
      .single();

    expect(after?.is_premium, "MONEY: a user turned a paid template free").toBe(true);
    expect(after?.unlock_cost_credits, "MONEY: a user zeroed a template's price").toBe(
      template.unlock_cost_credits,
    );
    expect(after?.slug, "a user rewrote the key the component registry joins on").toBe(
      template.slug,
    );
  });

  it("the catalog carries no write policy at all", async () => {
    // The structural reason the above holds. Stated separately so that adding
    // a write policy fails loudly here with an explanation, rather than only
    // showing up as a surprising data change in the test above.
    const { data } = await admin
      .from("resume_templates")
      .select("id")
      .limit(1);
    expect(data ?? [], "catalog should be readable").not.toHaveLength(0);

    const { error } = await user.client
      .from("resume_templates")
      .insert({ name: "x", slug: "x", industry_category: "x" });
    expect(error, "a user must not be able to add catalog rows either").not.toBeNull();
  });
});
