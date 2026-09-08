/**
 * Is `"job_review"` (0118) actually usable by `requirePermission`?
 *
 * `AdminPermission` (src/lib/admin/session.ts) is a hand-maintained TS union
 * meant to track the Postgres enum, and nothing enforces that they stay in
 * sync — this drives `requirePermission` with a real identity rather than
 * re-deriving the answer from reading the source.
 *
 * `next/headers` and `next/navigation` are mocked because `require-admin.ts`
 * imports both at module scope even on the success path this test exercises.
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

describe("requirePermission(\"job_review\") — 0118's new value", () => {
  it("resolves the identity when the operator's role grants it", async () => {
    identity.current = fakeIdentity(["job_review"]);
    const resolved = await requirePermission("job_review");
    expect(resolved.email).toBe("operator@talentrah.test");
  });

  it("refuses an operator whose role does not grant it", async () => {
    identity.current = fakeIdentity(["reported_postings"]);
    await expect(requirePermission("job_review")).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("refuses when nobody is signed in at all", async () => {
    identity.current = null;
    await expect(requirePermission("job_review")).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
