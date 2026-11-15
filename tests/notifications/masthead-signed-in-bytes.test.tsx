/**
 * NOTIF PR-B, flags OFF: the signed-in masthead's HTML does not change. The file under __snapshots__ was captured from main BEFORE any PR-B code existed (this test is the first commit of the branch, green on
 * unchanged code). The U2 commit adds the bell behind a prop that is absent when notifications_master is off; this test must stay green, byte for byte, for that case.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs" }));
const { Masthead } = await import("@/components/app-shell/masthead");

const PROPS = { initials: "AB", email: "ada@example.test", displayName: "Ada Bello", creditsBalance: 12, activePass: null, isOrganisationMember: true };

describe("the signed-in masthead markup (PR-B, flags off)", () => {
  it("is byte-identical to the snapshot taken from main", async () => {
    await expect(renderToStaticMarkup(<Masthead {...PROPS} />)).toMatchFileSnapshot("./__snapshots__/masthead-signed-in.html");
  });
  it("the snapshot is a real masthead (so a byte match is not two empty strings)", () => {
    const html = renderToStaticMarkup(<Masthead {...PROPS} />);
    expect(html).toContain("12 credits");
    expect(html).toContain('data-testid="masthead-actions"');
    expect(html.length).toBeGreaterThan(2000);
  });
});
