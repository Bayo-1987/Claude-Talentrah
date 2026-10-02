/**
 * The Extend landing page and its action.
 *
 * THE RULE THIS FILE PROTECTS: opening the link never extends anything. Mail clients, security scanners and link
 * previewers all fetch URLs from messages without a person ever clicking, and a GET that extended a posting would let
 * each of them quietly push a closing date out. So the page is a confirm screen; only the button, a form POST to a
 * Server Action, redeems the token.
 *
 * Every refusal is a clear message on a normal page, not an error page; an unknown, tampered or expired link all say the
 * same generic thing, so the page cannot be used to learn which links exist.
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

/** Static markup HTML-escapes apostrophes; compare on the text a person reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

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
  it("the confirm page names the job and shows the CURRENT and the NEW closing date before the button, and does NOT redeem", async () => {
    extend.peek.mockResolvedValue({
      state: "ready",
      jobId: "job-1",
      title: "Backend Engineer",
      closesAt: "2026-10-05T12:00:00.000Z",
      newClosesAt: "2026-11-04T12:00:00.000Z",
    });
    const html = await render();
    const t = text(html);

    expect(extend.redeem).not.toHaveBeenCalled();
    expect(t).toContain("Backend Engineer");
    expect(t).toContain("5 Oct 2026");
    expect(t).toContain("4 Nov 2026");
    expect(html).toMatch(/<form/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Extend 30 days/);
    // The dates come BEFORE the button.
    expect(t.indexOf("4 Nov 2026")).toBeLessThan(t.indexOf("Extend 30 days"));
  });

  it("is noindex", async () => {
    const { metadata } = await import("@/app/extend-posting/[token]/page");
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("used: 'Already extended' and the CURRENT closing date, with no button, and no redeem", async () => {
    extend.peek.mockResolvedValue({ state: "used", title: "Backend Engineer", closesAt: "2026-12-02T12:00:00.000Z" });
    const html = await render();
    expect(text(html)).toContain("Already extended. This job now closes 2 Dec 2026");
    expect(html).not.toContain("Extend 30 days");
    expect(extend.redeem).not.toHaveBeenCalled();
  });

  it("used with no date to name: still says it was already extended", async () => {
    extend.peek.mockResolvedValue({ state: "used" });
    expect(text(await render())).toContain("Already extended");
  });

  it("closed: says the job has closed, tells them to reopen it from the dashboard, and links to Jobs Posted", async () => {
    extend.peek.mockResolvedValue({ state: "closed" });
    const html = await render();
    expect(text(html)).toContain("This job has closed. Reopen it from your dashboard");
    expect(html).toContain('href="/employer/jobs"');
    expect(html).not.toContain("Extend 30 days");
  });

  it("no closing date (or an external posting): says so", async () => {
    extend.peek.mockResolvedValue({ state: "no_closing_date" });
    const html = await render();
    expect(text(html)).toContain("This job has no closing date");
    expect(html).not.toContain("Extend 30 days");
  });

  it.each(["invalid", "expired"])(
    "%s: the same generic message, so it cannot be used to tell which links exist",
    async (state) => {
      extend.peek.mockResolvedValue({ state });
      const html = await render();
      expect(text(html)).toContain("This link isn't valid");
      expect(html).not.toContain("Extend 30 days");
      expect(extend.redeem).not.toHaveBeenCalled();
    },
  );

  it("the generic message is identical for an unknown token and an expired one (nothing to distinguish them)", async () => {
    extend.peek.mockResolvedValue({ state: "invalid" });
    const a = await render();
    extend.peek.mockResolvedValue({ state: "expired" });
    const b = await render();
    expect(a).toBe(b);
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

  it.each(["used", "expired", "invalid", "closed", "no_closing_date"])("passes a %s refusal through unchanged", async (outcome) => {
    extend.redeem.mockResolvedValue({ outcome });
    const { extendPostingAction } = await import("@/app/extend-posting/[token]/actions");
    expect(await extendPostingAction(TOKEN)).toMatchObject({ outcome });
  });
});

describe("the messages a refused POST shows (same copy as the GET page)", () => {
  it("each refusal reads clearly, and 'used' names the current date", async () => {
    const { refusalCopy } = await import("@/app/extend-posting/[token]/copy");
    expect(refusalCopy({ outcome: "used", closesAt: "2026-12-02T12:00:00.000Z" })).toEqual({
      heading: "Already extended.",
      body: "This job now closes 2 Dec 2026.",
    });
    expect(refusalCopy({ outcome: "closed" })).toMatchObject({
      heading: "This job has closed.",
      body: "Reopen it from your dashboard.",
    });
    expect(refusalCopy({ outcome: "no_closing_date" }).heading).toBe("This job has no closing date.");
    expect(refusalCopy({ outcome: "invalid" }).heading).toBe("This link isn't valid.");
    expect(refusalCopy({ outcome: "expired" })).toEqual(refusalCopy({ outcome: "invalid" }));
    expect(refusalCopy({ outcome: "error" }).heading).toMatch(/did not go through/);
  });
});
