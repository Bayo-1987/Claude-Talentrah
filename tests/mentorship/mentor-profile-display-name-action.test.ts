/**
 * send-418 — applyToBecomeMentorAction / updateMentorProfileAction actually
 * persist display_name and surface warnIfNameLooksLikeOwnOrg's warning as a
 * non-blocking "warning" state, not just that the underlying pieces
 * (the column, the SQL function, the pure heuristic) are each correct in
 * isolation. createClient() is mocked to return a REAL, RLS-honouring
 * session (sessionFor(), same pattern tests/passes/pass-covered-actions.test.ts
 * already uses for actions gated by requireUser()) rather than a stub —
 * these actions genuinely write through RLS and the 0184 column grant, and a
 * stub client would either fail outright or silently answer as `anon`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`mentor-profile-display-name-action suite cannot run: ${key} is not set.`);
}

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
// Server Actions' own revalidatePath needs an active Next.js request/
// static-generation context a plain vitest run never has — irrelevant to
// what this suite tests, so stubbed out the same way pass-covered-actions
// does.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { applyToBecomeMentorAction, updateMentorProfileAction } = await import("@/lib/mentorship/actions");

const tag = randomUUID().replace(/-/g, "").slice(0, 10);
const uniqueWord = `mpword${tag}`;

let cleanUser: { id: string; email: string };
let orgOwner: { id: string; email: string };
let orgId: string;

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  [cleanUser, orgOwner] = await Promise.all([
    createTestUser(`mp-dispname-clean-${tag}`),
    createTestUser(`mp-dispname-orgowner-${tag}`),
  ]);

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `${uniqueWord} circle`, domain: `${tag}.example`, created_by: orgOwner.id })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);
}, 60_000);

afterEach(async () => {
  await admin.from("mentor_profiles").delete().in("user_id", [cleanUser.id, orgOwner.id]);
});

afterAll(async () => {
  await deleteTestOrgs([orgId]);
  await deleteTestUsers([cleanUser.id, orgOwner.id]);
}, 60_000);

describe("applyToBecomeMentorAction — display_name", () => {
  it("persists an ordinary display_name and returns success, not a warning", async () => {
    testClientRef.current = await sessionFor(cleanUser.email, cleanUser.id);
    const result = await applyToBecomeMentorAction(null, formData({ displayName: "Nkem Adeyemi" }));
    expect(result.status).toBe("success");

    const { data } = await admin.from("mentor_profiles").select("display_name").eq("user_id", cleanUser.id).single();
    expect(data?.display_name).toBe("Nkem Adeyemi");
  });

  it("REGRESSION: persists the row AND still returns a non-blocking warning when the display_name matches the caller's own organisation", async () => {
    testClientRef.current = await sessionFor(orgOwner.email, orgOwner.id);
    const result = await applyToBecomeMentorAction(null, formData({ displayName: `${uniqueWord} Reviewer` }));
    expect(result.status, "a name-similarity match must warn, not error or silently succeed").toBe("warning");
    expect(result.message).toMatch(/organisation name/i);

    // Non-blocking: the application must still have gone through.
    const { data } = await admin
      .from("mentor_profiles")
      .select("display_name, status")
      .eq("user_id", orgOwner.id)
      .single();
    expect(data?.display_name).toBe(`${uniqueWord} Reviewer`);
    expect(data?.status).toBe("pending");
  });
});

describe("updateMentorProfileAction — display_name", () => {
  it("lets an existing mentor set display_name after the fact, via the 0184 column grant", async () => {
    const { error: insertError } = await admin
      .from("mentor_profiles")
      .insert({ user_id: cleanUser.id, status: "approved", bio: "fixture" });
    if (insertError) throw insertError;

    testClientRef.current = await sessionFor(cleanUser.email, cleanUser.id);
    const result = await updateMentorProfileAction(null, formData({ displayName: "Chosen Later" }));
    expect(result.status).toBe("success");

    const { data } = await admin.from("mentor_profiles").select("display_name").eq("user_id", cleanUser.id).single();
    expect(data?.display_name).toBe("Chosen Later");
  });
});
