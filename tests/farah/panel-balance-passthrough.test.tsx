/**
 * The panel hands the balance the shell shows to the chips (so the chips' cost label can say "(you have N)"). A static render cannot load the free-message count, so the chips are replaced by a spy component and the
 * balance hook by a mock: what the spy receives is exactly what the panel passes. Without this the pass-through (panel -> chips) had no test.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/billing", useSearchParams: () => new URLSearchParams() }));
let balance: number | undefined;
vi.mock("@/components/app-shell/credits-balance", () => ({ useKnownCreditsBalance: () => balance, useReportCreditsBalance: () => () => {} }));
const received: Array<Record<string, unknown>> = [];
vi.mock("@/components/app-shell/farah-quick-actions", () => ({
  FarahQuickActions: (props: Record<string, unknown>) => {
    received.push(props);
    return null;
  },
  FarahAllowanceNote: () => null,
}));
const { FarahPanel } = await import("@/components/app-shell/farah-panel");

describe("panel -> chips", () => {
  it("passes the balance the hook reports, and the chips for the current page", () => {
    received.length = 0;
    balance = 7;
    renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    expect(received.length).toBeGreaterThan(0);
    expect(received.at(-1)!.balance).toBe(7);
    expect((received.at(-1)!.actions as Array<{ key: string }>).map((a) => a.key)).toEqual(["billing-use-credits", "billing-pack-or-pass", "billing-free"]);
  });
  it("passes 'not known' (undefined) when the hook has no balance, never a guessed number", () => {
    received.length = 0;
    balance = undefined;
    renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    expect(received.at(-1)!.balance).toBeUndefined();
  });
  it("follows the hook: a different balance is a different prop", () => {
    received.length = 0;
    balance = 0;
    renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    expect(received.at(-1)!.balance).toBe(0);
  });
});
