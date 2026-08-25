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

beforeAll(async () => {
  user = await createAuthedUser("owner");
});

afterAll(async () => {
  if (user) await admin.auth.admin.deleteUser(user.id);
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
      await admin.from("organization_members").delete().eq("organization_id", org!.id);
      await admin.from("organizations").delete().eq("id", org!.id);
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
      await admin.from("organization_members").delete().eq("organization_id", org!.id);
      await admin.from("organizations").delete().eq("id", org!.id);
    }
  });
});
