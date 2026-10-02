/**
 * EMP-1 / E1 — the Talent Directory waitlist.
 *
 * WHY A TABLE AND NOT THE /contact FORM. The only existing lead-capture path is /contact: a public form that e-mails the support inbox
 * through Resend and stores nothing. A waitlist exists so that someone can later be told "10+ are listed", which needs a durable,
 * queryable row; an e-mail in an inbox cannot be queried, deduplicated per organisation, or made idempotent, and it asks a signed-in
 * employer to retype a name and e-mail we already hold. So this adds the one small table, locked down: no client can read or write it.
 *
 * Joining costs nothing and works for any member of an organisation that has no subscription: it touches no payment table and no
 * subscription row, and a second join is a no-op, not an error and not a duplicate.
 *
 * Service-role-only tests: run anywhere with the TEST project env. The `authenticated` half (a session cannot read or write the table)
 * needs a minted session and lives in tests/rls/talent-directory-preview.test.ts's sibling check below, which is CI-bound.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { joinTalentDirectoryWaitlist } from "@/lib/talent-directory/waitlist-runner";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory waitlist suite cannot run: ${key} is not set.`);
}

let ownerId: string;
let memberId: string;
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  const [owner, member] = await Promise.all([createTestUser("tdwait-owner"), createTestUser("tdwait-member")]);
  ownerId = owner.id;
  memberId = member.id;
  const [a, b] = await Promise.all([
    admin.from("organizations").insert({ name: `TDWait Org ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true }).select("id").single(),
    admin.from("organizations").insert({ name: `TDWait Other ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true }).select("id").single(),
  ]);
  orgId = a.data!.id;
  otherOrgId = b.data!.id;
  await admin.from("organization_members").insert([
    { organization_id: orgId, user_id: ownerId, role: "owner" },
    { organization_id: orgId, user_id: memberId, role: "admin" },
    { organization_id: otherOrgId, user_id: ownerId, role: "owner" },
  ]);
}, 60_000);

afterAll(async () => {
  await admin.from("talent_directory_waitlist").delete().in("organization_id", [orgId, otherOrgId].filter(Boolean));
  await deleteTestOrgs([orgId, otherOrgId].filter(Boolean));
  await deleteTestUsers([ownerId, memberId].filter(Boolean));
}, 60_000);

async function rowsFor(organizationId: string) {
  const { data, error } = await admin.from("talent_directory_waitlist").select("*").eq("organization_id", organizationId);
  expect(error, error?.message).toBeNull();
  return data ?? [];
}

describe("joinTalentDirectoryWaitlist", () => {
  it("joins an organisation that has no subscription, with no payment of any kind", async () => {
    const before = await admin.from("payment_transactions").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    const result = await joinTalentDirectoryWaitlist(admin, { organizationId: orgId, userId: ownerId });
    expect(result).toBe("joined");

    const rows = await rowsFor(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].joined_by).toBe(ownerId);

    const after = await admin.from("payment_transactions").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    expect(after.count).toBe(before.count);
    const { data: subs } = await admin.from("talent_directory_subscriptions").select("id").eq("organization_id", orgId);
    expect(subs ?? [], "joining the waitlist created a subscription row").toEqual([]);
  });

  it("is idempotent: a second join by the same user, or by a colleague, does not error and does not duplicate", async () => {
    expect(await joinTalentDirectoryWaitlist(admin, { organizationId: orgId, userId: ownerId })).toBe("already_joined");
    expect(await joinTalentDirectoryWaitlist(admin, { organizationId: orgId, userId: memberId })).toBe("already_joined");
    const rows = await rowsFor(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].joined_by, "a later join overwrote the original").toBe(ownerId);
  });

  it("concurrent joins still leave exactly one row", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => joinTalentDirectoryWaitlist(admin, { organizationId: otherOrgId, userId: ownerId })),
    );
    expect(results.filter((r) => r === "joined")).toHaveLength(1);
    expect(await rowsFor(otherOrgId)).toHaveLength(1);
  });

  it("the row is unique per organisation at the database, not only in the runner", async () => {
    const { error } = await admin.from("talent_directory_waitlist").insert({ organization_id: orgId, joined_by: memberId });
    expect(error?.code, "a duplicate waitlist row was accepted").toBe("23505");
  });

  it("deleting the organisation removes its waitlist row (it must not block org deletion)", async () => {
    const { data: tmp } = await admin
      .from("organizations")
      .insert({ name: `TDWait Tmp ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true })
      .select("id")
      .single();
    await joinTalentDirectoryWaitlist(admin, { organizationId: tmp!.id, userId: ownerId });
    await deleteTestOrgs([tmp!.id]);
    const { data } = await admin.from("organizations").select("id").eq("id", tmp!.id);
    expect(data ?? []).toEqual([]);
    expect(await rowsFor(tmp!.id)).toEqual([]);
  });
});

describe("the waitlist table is closed to every client role", () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it("anon cannot read it", async () => {
    const { data, error } = await anon.from("talent_directory_waitlist").select("*");
    // either a permission error, or (if a grant slipped through) RLS must still return nothing: never a row
    expect(data ?? []).toEqual([]);
    expect(error, "anon was granted SELECT on the waitlist").not.toBeNull();
  });

  it("anon cannot insert into it", async () => {
    const { error } = await anon.from("talent_directory_waitlist").insert({ organization_id: orgId });
    expect(error).not.toBeNull();
    expect(await rowsFor(orgId)).toHaveLength(1);
  });
});
