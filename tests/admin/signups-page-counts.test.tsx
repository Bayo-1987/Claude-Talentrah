import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Signups PAGE prints the same count the nav carries, in its own words (ADMIN-NAV-SIGNUPS-COUNT-ABSORB-1): "1 person", "2 people", and "No signups match." for none. The page is rendered for real here, with the session check, the audit write and the
 * list query stood in, so the sentence under the filters and the page's heading are what a reader would see; its browser-tab title is the module's own `metadata` export.
 */
const state = vi.hoisted(() => ({ total: 0, audits: 0 }));

vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ adminId: "admin-1", email: "operator", displayName: "Operator", sessionId: "s-1", permissions: ["people_list"] }) }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: async () => void state.audits++ }));
vi.mock("@/lib/admin/people/queries", () => ({
  listSignups: async () => ({ rows: [], total: state.total, page: 1, pageCount: Math.max(1, Math.ceil(state.total / 50)) }),
}));
vi.mock("@/lib/admin/people/actions", () => ({ countNewSignupsAction: async () => 0 }));

const page = await import("@/app/admin/(protected)/people/signups/page");

async function render() {
  return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
}
const countLine = (html: string) => html.match(/<p class="text-\[14px\] text-ink-soft">([^<]*)<\/p>/)?.[1];

beforeEach(() => {
  state.total = 0;
  state.audits = 0;
});

describe("the sentence under the filters", () => {
  it.each([
    [0, "No signups match."],
    [1, "1 person · page 1 of 1"],
    [2, "2 people · page 1 of 1"],
    [50, "50 people · page 1 of 1"],
    [1234, "1,234 people · page 1 of 25"],
  ])("%i in total reads %j", async (total, sentence) => {
    state.total = total;
    expect(countLine(await render())).toBe(sentence);
  });
});

describe("the page is named for what it lists", () => {
  it("its browser-tab title is 'Signups — Talentrah admin'", () => {
    expect(page.metadata.title).toBe("Signups — Talentrah admin");
  });

  it("its heading area says 'Signups' and that everyone with an account is listed", async () => {
    const html = await render();
    expect(html).toContain("Signups");
    expect(html).toContain("Newest first. Everyone with an account, job seekers and employers.");
    expect(html).not.toContain("Job seekers only");
  });

  it("opening it still writes its one audit event (people.listed belongs to this page, not to the nav)", async () => {
    await render();
    expect(state.audits).toBe(1);
  });
});
