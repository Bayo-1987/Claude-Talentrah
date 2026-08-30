/**
 * 0068's column, and the claim the whole mitigation rests on.
 *
 * The exposure: an admin's credential is a seeker credential, so anyone with
 * an operator's email inbox can reset the password and sign in at
 * /admin/login. MFA closes it only if a password-only session genuinely cannot
 * remove the factor — otherwise the attacker resets, unenrolls, and walks in.
 *
 * That is asserted here against the real API rather than taken from
 * documentation, because if it is false the feature is theatre.
 *
 * The second half pins `mfa_enrolled_at` to the same access shape as the rest
 * of `admin_users`: unreachable by any client. A column that says "this
 * operator is protected" is exactly the sort a compromised session would want
 * to write.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ephemeral = (): DB =>
  createClient<Database>(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

/** RFC 6238, inline: the suite needs to produce one valid code, not ship a library. */
function totp(secret: string): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    bits += A.indexOf(c).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

let operator: Awaited<ReturnType<typeof createAuthedTestUser>>;
let seeker: Awaited<ReturnType<typeof createAuthedTestUser>>;
const PASSWORD = `Mfa-${randomUUID()}Aa1!`;

beforeAll(async () => {
  operator = await createAuthedTestUser("mfa-operator");
  seeker = await createAuthedTestUser("mfa-seeker");

  // createAuthedTestUser mints a token without setting a password; MFA needs a
  // real password login, so set one.
  const { error: pwError } = await admin.auth.admin.updateUserById(operator.id, {
    password: PASSWORD,
  });
  if (pwError) throw pwError;

  const { error } = await admin.from("admin_users").insert({
    id: operator.id,
    email: operator.email.toLowerCase(),
    display_name: "MFA Fixture",
  });
  if (error) throw new Error(`could not create the fixture operator: ${error.message}`);
});

afterAll(async () => {
  await admin.from("admin_audit_log").delete().eq("admin_user_id", operator.id);
  await deleteTestUsers([operator.id, seeker.id]);
});

describe("a password-only session cannot remove a verified factor", () => {
  it("REFUSES unenroll at aal1 — the claim the mitigation depends on", async () => {
    const c1 = ephemeral();
    const { error: signIn } = await c1.auth.signInWithPassword({
      email: operator.email,
      password: PASSWORD,
    });
    expect(signIn).toBeNull();

    const { data: enrolled, error: enrolError } = await c1.auth.mfa.enroll({ factorType: "totp" });
    expect(enrolError).toBeNull();
    const factorId = enrolled!.id;

    const { error: verifyError } = await c1.auth.mfa.challengeAndVerify({
      factorId,
      code: totp(enrolled!.totp.secret),
    });
    expect(verifyError, "a freshly generated code should verify").toBeNull();

    const { data: level } = await c1.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(level?.currentLevel).toBe("aal2");

    /*
     * The attacker's position: a fresh password-only login on an account whose
     * factor is already verified. If this could unenroll, resetting a
     * password would be enough to strip the factor and the feature would be
     * decoration.
     */
    const c2 = ephemeral();
    await c2.auth.signInWithPassword({ email: operator.email, password: PASSWORD });
    const { data: attackerLevel } = await c2.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(attackerLevel?.currentLevel).toBe("aal1");

    const { error: unenrollError } = await c2.auth.mfa.unenroll({ factorId });
    expect(unenrollError, "aal1 could remove the factor — the mitigation is bypassable").not.toBeNull();
    expect(unenrollError?.message ?? "").toMatch(/aal2/i);

    // Clean up so the fixture user can be deleted without a lingering factor.
    await admin.auth.admin.mfa.deleteFactor({ userId: operator.id, id: factorId });
  });
});

describe("mfa_enrolled_at is unreachable by any client", () => {
  it("a signed-in seeker cannot read or write it", async () => {
    const read = await seeker.client.from("admin_users").select("mfa_enrolled_at").limit(1);
    // admin_users has every privilege revoked from authenticated (0060), so
    // this is an ERROR rather than an empty read — the distinction that has
    // produced four findings in this repo.
    expect(read.error).not.toBeNull();
    expect(read.data).toBeNull();

    const write = await seeker.client
      .from("admin_users")
      .update({ mfa_enrolled_at: new Date().toISOString() })
      .eq("id", operator.id);
    expect(write.error).not.toBeNull();

    const { data } = await admin
      .from("admin_users")
      .select("mfa_enrolled_at")
      .eq("id", operator.id)
      .single();
    expect(data?.mfa_enrolled_at).toBeNull();
  });
});
