/**
 * EMP-1 / E1 — /employer/talent-directory for an employer who is signed in to an organisation with no subscription.
 *
 * The page is rendered for real (the async server component is awaited and its element tree is rendered to static markup); only the
 * data edges are replaced: the organisation context, the service-role reads (subscription, plans, waitlist) and the preview RPC.
 * It must render the preview state at 9 candidates (no Subscribe, waitlist offered), the normal Subscribe flow at 10, the
 * "already on the waitlist" state, and the unchanged subscribed view for an org that does have an active subscription.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  subscription: null as null | { status: string; expires_at: string },
  onWaitlist: false,
  preview: { count: 0, samples: [] as unknown[] },
  searchCalls: 0,
}));

vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({
    userId: "user-1",
    userEmail: "owner@example.com",
    emailConfirmed: true,
    organization: { id: "org-1", name: "Acme" },
    role: "owner",
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => {
        if (table === "talent_directory_subscriptions") return { data: state.subscription, error: null };
        if (table === "talent_directory_waitlist") return { data: state.onWaitlist ? { id: "w-1" } : null, error: null };
        return { data: null, error: null };
      };
      q.then = (resolve: (v: unknown) => void) =>
        resolve(
          table === "talent_directory_plans"
            ? { data: [{ id: "plan-1", name: "Local Sourcing — Monthly", price_ngn: 200000 }], error: null }
            : { data: [], error: null },
        );
      return q;
    },
  }),
}));

vi.mock("@/lib/talent-directory/queries", () => ({
  getTalentDirectoryPreview: async () => state.preview,
  searchTalentDirectory: async () => {
    state.searchCalls += 1;
    return [];
  },
}));

vi.mock("@/lib/talent-directory/subscription-actions", () => ({
  purchaseTalentDirectorySubscriptionAction: async () => {},
}));
vi.mock("@/lib/talent-directory/waitlist-actions", () => ({
  joinTalentDirectoryWaitlistAction: async () => {},
}));

import EmployerTalentDirectoryPage from "@/app/employer/talent-directory/page";

async function render(search: Record<string, string> = {}): Promise<string> {
  const element = await EmployerTalentDirectoryPage({ searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  state.subscription = null;
  state.onWaitlist = false;
  state.preview = { count: 0, samples: [] };
  state.searchCalls = 0;
});

describe("an org with no subscription", () => {
  it("at 9 candidates: the building copy, the waitlist, and NO Subscribe button", async () => {
    state.preview = { count: 9, samples: [] };
    const html = await render();
    expect(html).toContain(
      "We&#x27;re building the directory: 9 verified candidates so far. Join the waitlist and we&#x27;ll tell you when 10+ are listed.",
    );
    expect(html).toContain("Join the waitlist");
    expect(html).not.toMatch(/Subscribe/);
    expect(state.searchCalls, "the paid search ran for an unsubscribed org").toBe(0);
  });

  it("at 1 candidate (production today) and at 0", async () => {
    for (const n of [1, 0]) {
      state.preview = { count: n, samples: [] };
      const html = await render();
      expect(html).toContain(`${n} verified candidates so far`);
      expect(html).not.toMatch(/Subscribe/);
    }
  });

  it("at exactly 10 candidates: the normal Subscribe flow with the real plan price", async () => {
    state.preview = { count: 10, samples: [] };
    const html = await render();
    expect(html).toContain("Subscribe — Local Sourcing — Monthly (₦200,000/mo)");
    expect(html).not.toContain("Join the waitlist");
  });

  it("shows up to three anonymised sample cards when the database returned them, and nothing identifying", async () => {
    state.preview = {
      count: 12,
      samples: [
        { role: "Engineering", yearsBand: "3-5", skills: ["react"], availableForHire: true, remoteReady: false },
        { role: "Design", yearsBand: "6-9", skills: [], availableForHire: false, remoteReady: true },
      ],
    };
    const html = await render();
    expect((html.match(/data-testid="preview-sample"/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/<img/i);
  });

  it("an org already on the waitlist sees the confirmation", async () => {
    state.preview = { count: 4, samples: [] };
    state.onWaitlist = true;
    const html = await render();
    expect(html).toContain("You&#x27;re on the waitlist");
    expect(html).not.toContain("Join the waitlist");
  });

  it("an error from the server action is still shown", async () => {
    state.preview = { count: 4, samples: [] };
    const html = await render({ error: "Something went wrong on our end." });
    expect(html).toContain("Something went wrong on our end.");
  });

  it("?waitlist=joined shows the joined state even before the row is re-read", async () => {
    state.preview = { count: 4, samples: [] };
    const html = await render({ waitlist: "joined" });
    expect(html).toContain("You&#x27;re on the waitlist");
  });
});

describe("an org WITH an active subscription: unchanged", () => {
  it("runs the paid search and shows the subscription line, not the preview or the waitlist", async () => {
    state.subscription = { status: "active", expires_at: new Date(Date.now() + 86_400_000).toISOString() };
    state.preview = { count: 1, samples: [] };
    const html = await render();
    expect(state.searchCalls).toBe(1);
    expect(html).toContain("Subscription active until");
    expect(html).not.toContain("Join the waitlist");
    expect(html).not.toContain("building the directory");
  });
});
