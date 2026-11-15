import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin/moderation/queues", () => ({ queueCounts: async () => ({ scholarships: 0, reports: 0, campaigns: 0, feedback: 0, courses: 0, ops: 0, finance: 0, employerVerification: 0, jobReview: 0, mentorReview: 0 }) }));
vi.mock("@/lib/admin/people/queries", () => ({ countSignups: async () => 0, countSignupEmployers: async () => 0 }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

const { AdminNav } = await import("@/components/admin/admin-nav");
const render = async (permissions: string[]) => renderToStaticMarkup(await AdminNav({ permissions: permissions as never }));

describe("the nav entry for User messages", () => {
  it("the nav entry shows only to holders of user_messaging", async () => {
    expect(await render(["user_messaging"])).toContain('href="/admin/messages"');
    expect(await render(["user_messaging"])).toContain("User messages");
    for (const other of [[], ["scholarships"], ["operators"], ["feature_flags", "people_list"]]) {
      expect(await render(other)).not.toContain("/admin/messages");
    }
  });
});
