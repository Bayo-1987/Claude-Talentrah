/**
 * Published listings live on THEIR OWN page (/admin/scholarships/published), not in the review queue. The queue's approve specs (admin-scholarship-review-queue,
 * admin-scholarship-deadline-note) find a card by its heading and expect it to be gone from /admin/scholarships once it is approved; a published list on that same page would
 * keep the approved card there under the same heading. So the queue page carries a link to the published page and no published rows, and the published page lists them with Edit.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  pending: [{ id: "p1", provider: "Prov P", programName: "Pending Programme", deadline: null, lastCheckedAt: null, reviewNote: null }] as unknown[],
  published: [{ id: "v1", provider: "Prov V", programName: "Published Programme", deadline: "2027-01-31" }] as unknown[],
}));
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ displayName: "Op", email: "op@example.test", adminId: "a1" }) }));
vi.mock("@/lib/admin/moderation/queues", () => ({ pendingScholarships: async () => state.pending, publishedScholarships: async () => state.published }));
vi.mock("@/lib/admin/moderation/actions", () => ({ decideScholarshipAction: async () => ({}) }));
vi.mock("@/components/admin/decision-form", () => ({ DecisionForm: () => null }));

describe("the review queue page", async () => {
  const { default: Page } = await import("@/app/admin/(protected)/scholarships/page");
  const html = renderToStaticMarkup(await Page());
  it("lists pending cards with an Edit link and NO published listing (an approved card must leave this page)", () => {
    expect(html).toContain("Pending Programme");
    expect(html).toContain('href="/admin/scholarships/p1/edit"');
    expect(html).not.toContain("Published Programme");
  });
  it("links to the published listings page", () => {
    expect(html).toContain('href="/admin/scholarships/published"');
  });
});

describe("the published listings page", async () => {
  const { default: Page } = await import("@/app/admin/(protected)/scholarships/published/page");
  it("lists each published listing as a card with an Edit link to its edit page", async () => {
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Published Programme");
    expect(html).toMatch(/<h[23][^>]*>Published Programme<\/h[23]>/);
    expect(html).toContain('href="/admin/scholarships/v1/edit"');
    expect(html).not.toContain("Pending Programme");
  });
  it("says so when nothing is published, and links back to the queue", async () => {
    state.published = [];
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Nothing published yet.");
    expect(html).toContain('href="/admin/scholarships"');
  });
});
