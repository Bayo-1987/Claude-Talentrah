/**
 * The campaign create and save errors must not show the employer the raw database message (it can name tables, constraints and policies). The text goes to the server log;
 * the employer sees a plain sentence, the typed values still come back (keep-input), and nothing is created, redirected or revalidated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dbError: { code: "23514", message: 'new row for relation "ad_campaigns" violates check constraint "ad_campaigns_secret_check"' } as { code: string; message: string },
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ role: "owner", userId: "u1", organization: { id: "o1" } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: null, error: h.dbError });
          if (prop === "single") return () => Promise.resolve({ data: null, error: h.dbError });
          return () => chain;
        },
      },
    );
    return { from: () => chain };
  },
}));

import { createCampaignAction, updateCampaignAction } from "@/lib/employer/campaign-actions";

const form = () => {
  const f = new FormData();
  f.set("name", "Backend push");
  f.set("jobPostingId", "j1");
  f.set("dailyRate", "2000");
  f.set("totalBudget", "30000");
  f.set("targetLocations", "Lagos");
  return f;
};

beforeEach(() => {
  h.revalidate.mockClear();
  h.redirect.mockClear();
});

describe("campaign save errors", () => {
  it("create: a database error shows a plain sentence, logs the raw text, keeps the typed values, and creates/redirects nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createCampaignAction(null, form());
    expect(result).toMatchObject({ error: expect.any(String), values: { name: "Backend push", dailyRate: "2000" } });
    const message = (result as { error: string }).error;
    expect(message).toBe("Couldn't create the campaign; nothing was changed. The error is in the server log.");
    expect(message).not.toContain("ad_campaigns");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ad_campaigns_secret_check"));
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("save: a database error shows a plain sentence, logs the raw text, keeps the typed values, and does not revalidate", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await updateCampaignAction("c1", null, form());
    const message = (result as { error: string }).error;
    expect(message).toBe("Couldn't save the campaign; nothing was changed. The error is in the server log.");
    expect(message).not.toContain("ad_campaigns");
    expect(result).toMatchObject({ values: { name: "Backend push" } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ad_campaigns_secret_check"));
    expect(h.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("the policy refusal (42501) keeps its own sentence, unchanged", async () => {
    h.dbError = { code: "42501", message: "new row violates row-level security policy" };
    const result = await createCampaignAction(null, form());
    expect((result as { error: string }).error).toBe("That job posting doesn't belong to your company.");
    h.dbError = { code: "23514", message: 'new row for relation "ad_campaigns" violates check constraint "ad_campaigns_secret_check"' };
  });
});
