/**
 * The Finance page breaks pending payments into lines that hide nothing: under 30 minutes (not counted), 30 minutes to 24 hours (the badge), over 24 hours (its own line, always shown when there is one,
 * even when the badge is 0, because a pending row that old may be a real charge whose confirmation was lost).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const health = vi.hoisted(() => ({
  value: {
    payments: [], pendingCount: 3, pendingRecent: 1, pendingCounted: 0, stalePending: 2, creditsByReason: [], passesByStatus: {}, passesAwaitingRenewalOutcome: 0, adWalletBalanceNgn: 0, adWalletCount: 0,
  } as Record<string, unknown>,
}));
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ displayName: "Op", email: "op@example.test" }) }));
vi.mock("@/lib/admin/finance/queries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/finance/queries")>()), financialHealth: async () => health.value }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the Finance page's pending lines", async () => {
  const { default: Page } = await import("@/app/admin/(protected)/finance/page");
  const render = async () => text(renderToStaticMarkup(await Page()));

  it("shows the stale line even when the badge number is 0", async () => {
    const out = await render();
    expect(out).toMatch(/2 payments? older than 24 hours/i);
    expect(out).toMatch(/not in the (navigation )?badge/i);
    expect(out).toMatch(/real payment|may be a real/i);
  });
  it("shows the badge band and the open-checkout band as their own lines", async () => {
    const out = await render();
    expect(out).toMatch(/0 payments? waiting between 30 minutes and 24 hours/i);
    expect(out).toMatch(/1 payment started in the last 30 minutes/i);
  });
  it("shows no stale line when there is none", async () => {
    health.value = { ...health.value, stalePending: 0, pendingCount: 1, pendingCounted: 0, pendingRecent: 1 };
    expect(await render()).not.toMatch(/older than 24 hours/i);
  });
  it("shows no pending block at all when nothing is pending", async () => {
    health.value = { ...health.value, stalePending: 0, pendingCount: 0, pendingCounted: 0, pendingRecent: 0 };
    expect(await render()).not.toMatch(/waiting between 30 minutes/i);
  });
});
