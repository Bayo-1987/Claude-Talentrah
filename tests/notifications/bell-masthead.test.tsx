/**
 * Flags OFF means no bell and the signed-in masthead is unchanged (byte-equal to the snapshot from main, in masthead-signed-in-bytes.test.tsx). Here: the masthead takes ONE optional prop; absent or false renders
 * the same markup as before; true adds the bell. The layout reads the notifications_master flag with the existing server reader (fails closed) in the same round trip as its other lookups and hands the result down.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs" }));
const { Masthead } = await import("@/components/app-shell/masthead");

const PROPS = { initials: "AB", email: "ada@example.test", displayName: "Ada Bello", creditsBalance: 12, activePass: null, isOrganisationMember: true };
const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("the masthead and the bell", () => {
  it("prop absent and prop false render identical markup, with no bell", () => {
    const none = renderToStaticMarkup(<Masthead {...PROPS} />);
    const off = renderToStaticMarkup(<Masthead {...PROPS} showNotificationBell={false} />);
    expect(off).toBe(none);
    expect(none).not.toContain("Notifications");
  });
  it("prop true adds the bell and nothing else removed", () => {
    const off = renderToStaticMarkup(<Masthead {...PROPS} />);
    const on = renderToStaticMarkup(<Masthead {...PROPS} showNotificationBell />);
    expect(on).toContain('aria-label="Notifications"');
    expect(on.length).toBeGreaterThan(off.length);
    expect(on.replace(/<div[^>]*data-notification-bell[\s\S]*?<\/div>/, "")).toContain("12 credits");
  });
  it("the masthead source has exactly one bell hook", () => {
    const src = read("src/components/app-shell/masthead.tsx");
    expect(src.match(/<NotificationBell/g)).toHaveLength(1);
    expect(src).toContain("{showNotificationBell && <NotificationBell />}");
  });
  it("the layout starts the master-flag read (request-memoised reader) alongside its existing lookups, awaits it after them, and passes the result", () => {
    const src = read("src/components/app-shell/app-shell.tsx");
    expect(src).toContain('import { inboxEnabled } from "@/lib/notifications/inbox/enabled"');
    expect(src).toMatch(/const bellOnPending = inboxEnabled\(\); const \[activePass, hasUnread, isMember\] = await Promise\.all\(\[/);
    expect(src).toContain("const bellOn = await bellOnPending;");
    expect(src).toContain("showNotificationBell={bellOn}");
  });
});
