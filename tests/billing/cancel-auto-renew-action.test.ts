/**
 * cancelAutoRenewAction (src/lib/billing/actions.ts): a cancel that did not take redirects to /billing?error=cancel_failed and does NOT revalidate; one that did revalidates as before.
 * No database: the session client and cancelPassAutoRenewal are faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelPassAutoRenewal = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
const world = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, pass: { id: "up1", user_id: "u1", auto_renew_status: "active" } as Record<string, unknown> | null }));

vi.mock("@/lib/billing/renewals", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/billing/renewals")>()), cancelPassAutoRenewal }));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), redirect }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: world.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: world.pass }) }) }) }),
  }),
}));

beforeEach(() => {
  cancelPassAutoRenewal.mockReset();
  revalidatePath.mockClear();
  redirect.mockClear();
  world.user = { id: "u1" };
  world.pass = { id: "up1", user_id: "u1", auto_renew_status: "active" };
});

describe("cancelAutoRenewAction", () => {
  it("a cancel that did not take: redirects to /billing?error=cancel_failed and does NOT revalidate", async () => {
    cancelPassAutoRenewal.mockResolvedValue({ ok: false });
    const { cancelAutoRenewAction } = await import("@/lib/billing/actions");

    await expect(cancelAutoRenewAction("up1")).rejects.toThrow("NEXT_REDIRECT:/billing?error=cancel_failed");

    expect(cancelPassAutoRenewal).toHaveBeenCalledWith("up1");
    expect(revalidatePath, "MONEY BUG: a failed cancel refreshed the page as if it had worked").not.toHaveBeenCalled();
  });

  it("a cancel that took: revalidates /billing, no redirect (unchanged)", async () => {
    cancelPassAutoRenewal.mockResolvedValue({ ok: true });
    const { cancelAutoRenewAction } = await import("@/lib/billing/actions");

    await cancelAutoRenewAction("up1");

    expect(revalidatePath).toHaveBeenCalledWith("/billing");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a Pass that is not active any more: nothing to do, no cancel call, no redirect (unchanged)", async () => {
    world.pass = { id: "up1", user_id: "u1", auto_renew_status: "canceled" };
    const { cancelAutoRenewAction } = await import("@/lib/billing/actions");

    await cancelAutoRenewAction("up1");

    expect(cancelPassAutoRenewal).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
