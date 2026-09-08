/**
 * Is a newly-added `AdminPermission` actually usable by `requirePermission`?
 *
 * This is a real question, not a formality: `AdminPermission` (src/lib/admin/
 * session.ts) is a hand-maintained TS union that is supposed to track the
 * Postgres enum, but nothing enforces that they stay in sync — a value added
 * to one and not the other would either fail to compile (caught) or compile
 * fine while the database has never heard of it (not caught by anything short
 * of running the guard). `requirePermission` itself is a two-line function
 * (`identity.permissions.includes(permission)`), so this drives it with a
 * real identity rather than re-deriving that from reading the source.
 *
 * `next/headers` and `next/navigation` are mocked because `require-admin.ts`
 * imports both at module scope even on the success path this test exercises
 * (`headers()` is only called inside `returnTripSuffix`, on the redirect
 * branch — but the import itself still needs to resolve outside a Next.js
 * request).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminIdentity } from "@/lib/admin/session";

const identity = vi.hoisted(() => ({ current: null as AdminIdentity | null }));

vi.mock("@/lib/admin/session", () => ({
  getAdminIdentity: vi.fn(async () => identity.current),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map()),
}));

/** Matches how Next's real `redirect()` behaves: it throws rather than returning. */
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

import { requirePermission } from "@/lib/admin/require-admin";

function fakeIdentity(permissions: AdminIdentity["permissions"]): AdminIdentity {
  return {
    sessionId: "session-1",
    adminId: "admin-1",
    email: "operator@talentrah.test",
    displayName: "Test Operator",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    role: "standard",
    roleId: "role-1",
    roleName: "Test Role",
    permissions,
  };
}

beforeEach(() => {
  identity.current = null;
});

describe("requirePermission(\"employer_verification\") — 0113's new value", () => {
  it("resolves the identity when the operator's role grants it", async () => {
    identity.current = fakeIdentity(["employer_verification"]);
    const resolved = await requirePermission("employer_verification");
    expect(resolved.email).toBe("operator@talentrah.test");
  });

  it("refuses an operator whose role does not grant it", async () => {
    // Some other real permission, deliberately not this one — proves the
    // check is specific to the permission asked for, not "is any admin".
    identity.current = fakeIdentity(["reported_postings"]);
    await expect(requirePermission("employer_verification")).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("refuses when nobody is signed in at all", async () => {
    identity.current = null;
    await expect(requirePermission("employer_verification")).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
