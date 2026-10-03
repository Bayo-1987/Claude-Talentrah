/**
 * #715 — saving the Company Profile must not un-verify an organisation an admin confirmed by CAC registration.
 *
 * THE BUG. `updateCompanyProfileAction` recomputed `verified` from the work-email domain rule alone and wrote it whenever it differed
 * from the stored value. An organisation verified by CAC confirmation (`cac_confirmed_at` set, the path for an employer whose email is
 * NOT at the company domain) evaluates false under that rule on every save, so the next save by any member cleared `verified`. The admin
 * CAC queue excludes rows with `cac_confirmed_at` set, so there was then no way back. Found by reading the code (#715); production had no
 * CAC-confirmed organisation yet, so nothing had been hurt.
 *
 * THIS PROVES THE MECHANISM through the real Server Action, not the helper: createClient() is mocked to a real, RLS-honouring session
 * (tests/support/auth.ts's sessionFor()), the way tests/employer/job-posting-skills.test.ts does it, and the verified bit is read back
 * with the service role. One employer identity and one organisation for the whole file (requireUser's cache() degrades to a module-level
 * memo outside a real request, so a second identity would silently resolve to the first); the organisation's state is reset between tests.
 *
 * THE FOUR CASES:
 *  1. CAC-confirmed + verified, the member's email is NOT at the claimed domain -> a save leaves it verified. (Red before the fix.)
 *  2. The same save still writes the new profile fields: the guard changes the badge, not the save.
 *  3. Control: a domain-verified organisation with NO CAC confirmation is still un-verified by a save the domain rule fails. The
 *     "in both directions" behaviour is unchanged, so this fix is not "never lower verified".
 *  4. CAC-confirmed but `verified` already false (what the bug itself left behind) -> the next save restores it, from the stored
 *     `cac_confirmed_at` and not from anything in the form.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateCompanyProfileAction } = await import("@/lib/employer/actions");

let userId: string;
let orgId: string;
// The member's email is at a test domain; the form below claims a DIFFERENT one, so the domain rule evaluates false for every save here.
const claimedDomain = `cacprofile-${randomUUID().slice(0, 8)}.example`;

function profileForm(name: string): FormData {
  const form = new FormData();
  form.set("name", name);
  form.set("domain", claimedDomain);
  form.set("description", "A description.");
  return form;
}

type OrgState = {
  verified?: boolean;
  cac_confirmed_at?: string | null;
  cac_confirmed_by?: string | null;
  cac_number?: string | null;
  cac_business_name?: string | null;
};

async function setOrg(fields: OrgState) {
  const { error } = await admin.from("organizations").update(fields).eq("id", orgId);
  if (error) throw new Error(`fixture org state: ${error.message}`);
}

async function readOrg() {
  const { data, error } = await admin
    .from("organizations")
    .select("name, verified, cac_confirmed_at, description")
    .eq("id", orgId)
    .single();
  if (error || !data) throw new Error(`fixture read: ${error?.message}`);
  return data;
}

beforeAll(async () => {
  const user = await createTestUser("cacprofile");
  userId = user.id;
  testClientRef.current = await sessionFor(user.email, userId);

  const { data: org, error } = await testClientRef.current
    .from("organizations")
    .insert({ name: `CACPROFILE-TEST-${randomUUID()}`, domain: claimedDomain, created_by: userId })
    .select("id")
    .single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  orgId = org.id;

  const { error: memberError } = await testClientRef.current
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);
}, 60_000);

beforeEach(async () => {
  await setOrg({ verified: false, cac_confirmed_at: null, cac_confirmed_by: null, cac_number: null, cac_business_name: null });
});

afterAll(async () => {
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteTestOrgs([orgId]);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("updateCompanyProfileAction and CAC-confirmed organisations (#715)", () => {
  it("1. a CAC-confirmed, verified organisation stays verified when a member whose email is not at the domain saves", async () => {
    await setOrg({ verified: true, cac_confirmed_at: new Date().toISOString(), cac_number: "RC000000", cac_business_name: "Registered Name Ltd" });

    const result = await updateCompanyProfileAction(null, profileForm("Renamed Company"));

    expect(result).toEqual({ ok: true });
    const org = await readOrg();
    expect(org.verified, "a CAC-confirmed organisation must stay verified through a profile save").toBe(true);
    expect(org.cac_confirmed_at).not.toBeNull();
  });

  it("2. the save itself still happens (the guard changes the badge, not the profile write)", async () => {
    await setOrg({ verified: true, cac_confirmed_at: new Date().toISOString() });

    await updateCompanyProfileAction(null, profileForm("Second Name"));

    const org = await readOrg();
    expect(org.name).toBe("Second Name");
    expect(org.description).toBe("A description.");
  });

  it("3. control: with no CAC confirmation, a save the domain rule fails still un-verifies (both directions unchanged)", async () => {
    await setOrg({ verified: true });

    await updateCompanyProfileAction(null, profileForm("Domain Only Company"));

    const org = await readOrg();
    expect(org.verified, "domain-only verification must still be re-evaluated, and lowered, on a save").toBe(false);
  });

  it("4. an organisation the bug left CAC-confirmed but unverified is restored by its next save, from the stored confirmation", async () => {
    await setOrg({ verified: false, cac_confirmed_at: new Date().toISOString() });

    await updateCompanyProfileAction(null, profileForm("Restored Company"));

    const org = await readOrg();
    expect(org.verified).toBe(true);
  });
});
