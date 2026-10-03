/**
 * Two sign-outs that look alike and must not be confused (S1-44's scopes, ACCT-1's decision).
 *
 *   the header's "Sign out"                 THIS device only (`local`): signing out on a laptop must not sign the phone out.
 *   "Keep the deletion" (account deletion)  EVERYWHERE (`global`): it is the person confirming that the deletion goes ahead, and account deletion
 *                                           signs out everywhere (the owner's standing decision), exactly as confirming it does.
 *
 * Side by side in one file so changing one cannot quietly change the other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })), getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/lib/resend/client", () => ({ sendDeletionLifecycleEmail: vi.fn() }));
vi.mock("@/lib/paystack/client", () => ({ deactivateAuthorization: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
}));

const { signOutAction } = await import("@/lib/auth/actions");
const { keepDeletionAction } = await import("@/lib/account-deletion/actions");

beforeEach(() => {
  auth.signOut.mockClear();
  redirect.mockClear();
});

describe("the two sign-outs, side by side", () => {
  it("the header's Sign out signs out this device only", async () => {
    await expect(signOutAction()).rejects.toMatchObject({ to: "/login" });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("'Keep the deletion' signs out EVERYWHERE, then goes to the home page", async () => {
    await expect(keepDeletionAction()).rejects.toMatchObject({ to: "/" });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("the two never share a scope", async () => {
    await signOutAction().catch(() => {});
    await keepDeletionAction().catch(() => {});
    const scopes = auth.signOut.mock.calls.map((c) => (c as unknown as [{ scope: string }])[0].scope);
    expect(scopes).toEqual(["local", "global"]);
  });
});
