/**
 * NAV-DROPDOWN-REALIGN-1 follow-up: the Refer a Friend link must have its route prefetched before the menu is opened.
 *
 * Why this exists. e2e/nav-responsiveness.spec.ts pins that a nav click paints its route's loading skeleton within 300 ms on a throttled link. That only holds when the route's shell is already
 * in the client cache, which next/link does by itself when the link scrolls into the viewport (production only). The old Refer a Friend link sat in the bar, so it was prefetched at page load.
 * The account menu's items are not mounted until the menu opens, so nothing prefetched them; a click then waits one throttled server round trip for the shell. The old link never had a pending
 * indicator (nothing in src/components/app-shell uses useLinkStatus): its feedback WAS the prefetch, and moving the link took the prefetch away.
 *
 * The fix is to prefetch the seeker-only menu link when the menu is mounted (the avatar is on every signed-in page), not when it is opened. Written before the change: red on the old menu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

const h = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, prefetch: undefined as unknown as ReturnType<typeof import("vitest").vi.fn> }));
h.prefetch = vi.fn();

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    useEffect: (fn: () => void | (() => void)) => void h.effects.push(fn),
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, () => undefined],
    useRef: (init: unknown) => ({ current: init }),
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/jobs", useRouter: () => ({ prefetch: h.prefetch }) }));

const { AccountMenu } = await import("@/components/app-shell/account-menu");
const { PrefetchOnMount } = await import("@/components/app-shell/prefetch-on-mount");

const BASE = { initials: "AB", email: "ada@example.test", displayName: "Ada Bello" };

function findByType(node: ReactNode, type: unknown): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    if (n.type === type) out.push(n);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(node);
  return out;
}

beforeEach(() => {
  h.effects.length = 0;
  h.prefetch.mockClear();
});

describe("PrefetchOnMount", () => {
  it("prefetches each href once, when it mounts (the effect), and renders nothing", () => {
    expect(PrefetchOnMount({ hrefs: ["/refer"] })).toBeNull();
    expect(h.prefetch).not.toHaveBeenCalled(); // nothing happens during render
    for (const run of h.effects) run();
    expect(h.prefetch.mock.calls).toEqual([["/refer"]]);
  });
});

describe("the account menu", () => {
  it("a seeker's menu (referHref given) mounts a prefetch for exactly that link, closed, with no click", () => {
    const tree = AccountMenu({ ...BASE, referHref: "/refer" }) as ReactElement;
    const prefetchers = findByType(tree, PrefetchOnMount);
    expect(prefetchers).toHaveLength(1);
    expect((prefetchers[0].props as { hrefs: string[] }).hrefs).toEqual(["/refer"]);
  });
  it("an employer's menu (no referHref) prefetches nothing", () => {
    const tree = AccountMenu({ ...BASE }) as ReactElement;
    expect(findByType(tree, PrefetchOnMount)).toHaveLength(0);
  });
});
