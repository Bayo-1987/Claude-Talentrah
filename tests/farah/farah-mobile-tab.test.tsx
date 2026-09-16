/**
 * FarahMobileTab (src/components/app-shell/farah-mobile-tab.tsx) —
 * the notification-dot prop threaded down from (app)/layout.tsx
 * (src/lib/notifications/unread.ts).
 *
 * `bg-rust` is the marker: FarahMark's own bare SVG (the `hasUnread={false}`
 * case) paints its circles via inline `fill` attributes, never a Tailwind
 * class, and this file's only other rust-adjacent class is `hover:text-rust`
 * on the button — a distinct token, not a substring match — so `bg-rust`
 * appearing at all is exactly and only the notification dot rendering.
 * Confirmed by reading farah-mark.tsx and this file directly, not assumed.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FarahMobileTab } from "@/components/app-shell/farah-mobile-tab";

describe("FarahMobileTab's notification dot", () => {
  it("does not render when hasUnreadNotification is omitted (the default)", () => {
    const html = renderToStaticMarkup(<FarahMobileTab />);
    expect(html).not.toContain("bg-rust");
  });

  it("does not render when hasUnreadNotification is explicitly false", () => {
    const html = renderToStaticMarkup(<FarahMobileTab hasUnreadNotification={false} />);
    expect(html).not.toContain("bg-rust");
  });

  it("SABOTAGE-PROOF TARGET: renders when hasUnreadNotification is true", () => {
    const html = renderToStaticMarkup(<FarahMobileTab hasUnreadNotification={true} />);
    expect(html).toContain("bg-rust");
  });

  it("still renders the tab's own button and label regardless of the dot", () => {
    // The dot is additive chrome, never a replacement for the existing
    // affordance — pinned here so a future change to the dot cannot
    // accidentally swallow the button it decorates.
    const withDot = renderToStaticMarkup(<FarahMobileTab hasUnreadNotification={true} />);
    const withoutDot = renderToStaticMarkup(<FarahMobileTab hasUnreadNotification={false} />);
    for (const html of [withDot, withoutDot]) {
      expect(html).toContain("Ask Farah");
      expect(html).toContain('data-testid="farah-mobile-tab"');
    }
  });
});
