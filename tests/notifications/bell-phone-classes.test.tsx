/**
 * N5: the bell on a phone. Layout cannot be measured here (e2e/notifications-bell-phone.spec.ts measures it in a browser); these tests pin the classes that make it: a 44px button, and a panel that is
 * positioned against the full-width masthead band below the sm breakpoint (so it spans the viewport instead of hanging off the bell), and the old 360px dropdown from sm up.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BellView } from "@/components/notifications/notification-bell";

const render = (open: boolean, unreadCount: number | null = 3) =>
  renderToStaticMarkup(<BellView open={open} items={[]} unreadCount={unreadCount} onToggle={() => undefined} onOpenItem={() => undefined} onMarkAll={() => undefined} />);
const classOf = (html: string, marker: string) => new RegExp(`<[^>]*${marker}[^>]*class="([^"]*)"|<[^>]*class="([^"]*)"[^>]*${marker}`).exec(html)?.slice(1).find(Boolean) ?? "";
const tokens = (c: string) => c.split(/\s+/).filter(Boolean);

describe("the bell button", () => {
  it("is at least 44px by 44px", () => {
    const t = tokens(classOf(render(false), 'aria-haspopup="dialog"'));
    expect(t).toContain("min-h-11");
    expect(t).toContain("min-w-11");
    expect(t).not.toContain("h-10");
    expect(t).not.toContain("min-w-10");
  });
  it("keeps its label, its count and its icon", () => {
    const html = render(false, 12);
    expect(html).toContain('aria-label="Notifications, 12 unread"');
    expect(html).toContain("9+");
    expect(html).toContain("<svg");
  });
});

describe("the panel", () => {
  const panel = () => tokens(classOf(render(true), 'role="dialog"'));
  it("below sm it is absolute against the masthead band: full width, directly under the header", () => {
    for (const c of ["absolute", "inset-x-0", "top-full"]) expect(panel(), c).toContain(c);
  });
  it("from sm up it is the 360px dropdown under the bell, as before", () => {
    for (const c of ["sm:inset-x-auto", "sm:right-0", "sm:top-[calc(100%+8px)]", "sm:w-[360px]"]) expect(panel(), c).toContain(c);
  });
  it("is no longer sized by a viewport width that hangs off the bell", () => {
    expect(panel().some((c) => c.includes("100vw"))).toBe(false);
    expect(panel().some((c) => /^w-\[/.test(c))).toBe(false);
  });
  it("the bell's own wrapper is positioned only from sm up, so below sm the panel measures from the full-width band", () => {
    const wrapper = tokens(classOf(render(false), "data-notification-bell"));
    expect(wrapper).toContain("sm:relative");
    expect(wrapper).not.toContain("relative");
  });
  it("Mark all read is a 44px target", () => {
    expect(tokens(classOf(render(true), "Mark all read")).length).toBeGreaterThanOrEqual(0);
    expect(render(true)).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Mark all read<\/button>/);
  });
  it("does not exist while closed", () => {
    expect(render(false)).not.toContain('role="dialog"');
  });
});
