/**
 * The Extend landing page and its action.
 *
 * THE RULE THIS FILE PROTECTS: opening the link never extends anything. Mail clients, security scanners and link
 * previewers all fetch URLs from messages without a person ever clicking, and a GET that extended a posting would let
 * each of them quietly push a closing date out. So the page is a confirm screen; only the button — a form POST to a
 * Server Action — redeems the token.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const extend = vi.hoisted(() => ({
  peek: vi.fn(),
  redeem: vi.fn(),
}));

vi.mock("@/lib/jobs/expiry-reminders/extend", () => ({
  peekExtendToken: extend.peek,
  redeemExtendToken: extend.redeem,
}));
vi.mock("@/components/marketing/marketing-masthead", () => ({ MarketingMasthead: () => null }));
vi.mock("@/components/marketing/marketing-footer", () => ({ MarketingFooter: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TOKEN = "a".repeat(43);

async function render(): Promise<string> {
  const { default: Page } = await import("@/app/extend-posting/[token]/page");
  const jsx = await Page({ params: Promise.resolve({ token: TOKEN }) });
  return renderToStaticMarkup(jsx);
}

beforeEach(() => {
  extend.peek.mockReset();
  extend.redeem.mockReset();
});

describe("GET (rendering the page)", () => {
  it("shows a confirm button and does NOT redeem", async () => {
    extend.peek.mockResolvedValue({
      state: "ready",
      jobId: "job-1",
      title: "Backend Engineer",
      closesAt: "2026-10-05T12:00:00.000Z",
    });
    const html = await render();

    expect(extend.redeem).not.toHaveBeenCalled();
    expect(html).toContain("Backend Engineer");
    expect(html).toContain("5 Oct 2026");
    expect(html).toContain("Extend 30 days");
    expect(html).toMatch(/<form/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });

  it("never carries the token in the markup beyond what the action needs, and is noindex", async () => {
    extend.peek.mockResolvedValue({ state: "ready", jobId: "j", title: "T", closesAt: "2026-10-05T12:00:00.000Z" });
    const { metadata } = await import("@/app/extend-posting/[token]/page");
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it.each([
    ["used", /already been used/i],
    ["expired", /has passed|already closed|expired/i],
    ["invalid", /didn.t work|isn.t valid|not valid/i],
    ["unavailable", /no longer open/i],
  ])("%s: says so, offers no button, and still does not redeem", async (state, message) => {
    extend.peek.mockResolvedValue({ state });
    const html = await render();
    expect(html).toMatch(message);
    expect(html).not.toContain("Extend 30 days");
    expect(extend.redeem).not.toHaveBeenCalled();
  });
});

describe("POST (the action)", () => {
  it("redeems exactly once and reports the new date", async () => {
    extend.redeem.mockResolvedValue({
      outcome: "extended",
      jobId: "job-1",
      title: "Backend Engineer",
      newExpiresAt: "2026-11-04T12:00:00.000Z",
    });
    const { extendPostingAction } = await import("@/app/extend-posting/[token]/actions");
    const out = await extendPostingAction(TOKEN);
    expect(extend.redeem).toHaveBeenCalledTimes(1);
    expect(extend.redeem).toHaveBeenCalledWith(TOKEN);
    expect(out).toMatchObject({ outcome: "extended", newExpiresAt: "2026-11-04T12:00:00.000Z" });
  });

  it.each(["used", "expired", "invalid", "unavailable"])("passes a %s refusal through unchanged", async (outcome) => {
    extend.redeem.mockResolvedValue({ outcome });
    const { extendPostingAction } = await import("@/app/extend-posting/[token]/actions");
    expect(await extendPostingAction(TOKEN)).toMatchObject({ outcome });
  });
});
