/** The bell as drawn: a count capped at "9+", a list with unread items marked, only same-origin paths as links, and nothing that reads as a progress meter. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BellView } from "@/components/notifications/notification-bell";

const noop = () => {};
const item = (over: Record<string, unknown> = {}) => ({ id: "n1", type: "m", title: "A good match", body: "Support Lead at Acme", link: "/jobs/1", createdAt: "2026-11-02T00:00:00Z", read: false, ...over });
const view = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<BellView open={false} items={[]} unreadCount={0} onToggle={noop} onOpenItem={noop} onMarkAll={noop} {...props} />);
const buttonText = (html: string) => /<button[^>]*aria-label="Notifications[^"]*"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1].replace(/<[^>]*>/g, "").trim() ?? "";

describe("the bell button", () => {
  it("is one button named Notifications with aria-expanded, and shows no count when nothing is unread", () => {
    const html = view();
    expect(html).toMatch(/<button[^>]*aria-label="Notifications"[^>]*aria-expanded="false"/);
    expect(buttonText(html)).toBe("");
  });
  it("shows the count capped at 9+: 9 as 9, 10 as 9+", () => {
    expect(buttonText(view({ unreadCount: 9 }))).toBe("9");
    expect(buttonText(view({ unreadCount: 10 }))).toBe("9+");
    expect(buttonText(view({ unreadCount: 250 }))).toBe("9+");
    expect(view({ unreadCount: 10 })).toContain('aria-label="Notifications, 10 unread"');
  });
  it("an unknown count (null) shows no number", () => {
    expect(buttonText(view({ unreadCount: null }))).toBe("");
  });
});

describe("the open list", () => {
  it("is not in the markup closed", () => {
    expect(view({ items: [item()] })).not.toContain("A good match");
  });
  it("lists the items; an unread one is marked, a read one is not; 'Mark all read' only when something is unread", () => {
    const html = view({ open: true, unreadCount: 1, items: [item(), item({ id: "n2", title: "Older", read: true, link: null })] });
    expect(html).toContain("A good match");
    expect(html).toContain("Older");
    expect(html).toMatch(/data-unread="true"/);
    expect(html.match(/data-unread="true"/g)).toHaveLength(1);
    expect(html).toContain("Mark all read");
    expect(view({ open: true, unreadCount: 0, items: [item({ read: true })] })).not.toContain("Mark all read");
  });
  it("an item with a same-origin path is a link; a link that is not a same-origin path is not rendered as one (the item still shows)", () => {
    const html = view({ open: true, unreadCount: 2, items: [item(), item({ id: "n2", title: "Elsewhere", link: "https://evil.example/x" }), item({ id: "n3", title: "Protocol-relative", link: "//evil.example" })] });
    expect(html).toContain('href="/jobs/1"');
    expect(html).not.toContain("evil.example");
    expect(html).toContain("Elsewhere");
    expect(html).toContain("Protocol-relative");
  });
  it("says so when there is nothing", () => {
    expect(view({ open: true })).toContain("Nothing new yet.");
  });
  it("shows a count, never a bar or a meter", () => {
    const html = view({ open: true, unreadCount: 5, items: [item()] });
    expect(html).not.toMatch(/role="progressbar"|<progress|<meter/);
  });
});
