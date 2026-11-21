import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationSettingsSummaryView } from "@/components/settings/notification-settings-summary";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferenceValues } from "@/components/settings/notification-preferences-model";

const row = (label: string, value: string) => new RegExp(`${label}</span><span[^>]*>${value}</span>`);
const render = (device: "on" | "off" | "blocked" | null, over: Partial<NotificationPreferenceValues> = {}) =>
  renderToStaticMarkup(<NotificationSettingsSummaryView values={{ ...DEFAULT_NOTIFICATION_PREFERENCES, ...over }} device={device} />);

describe("the Settings summary card", () => {
  it("has the three lines and one button to the detail page", () => {
    const html = render("off");
    expect(html).toMatch(row("Push on this device", "Off"));
    expect(html).toMatch(/1 of 6 categories on/);
    expect(html).toMatch(row("Email", "On"));
    const link = /<a [^>]*href="\/settings\/notifications"[^>]*>([^<]*)<\/a>/.exec(html);
    expect(link?.[1]).toBe("Manage notifications");
    expect(link?.[0]).toMatch(/min-h-\[44px\]/);
    expect(html.match(/href="\/settings\/notifications"/g)).toHaveLength(1);
  });
  it("push on this device reads On, Off and Blocked", () => {
    expect(render("on")).toMatch(row("Push on this device", "On"));
    expect(render("blocked")).toMatch(/Blocked/);
    expect(render("off")).not.toMatch(/Blocked/);
  });
  it("while the device state is not known yet it does not claim On or Blocked", () => {
    const html = render(null);
    expect(html).not.toMatch(row("Push on this device", "(On|Blocked in this browser)"));
    expect(html).toMatch(/Checking/);
  });
  it("counts categories from the saved row and shows email off only when both email switches are off", () => {
    expect(render("off", { push_new_applicant: true, push_match_alert: true })).toMatch(/3 of 6 categories on/);
    expect(render("off", { email_announcements: false, email_promotions: false })).toMatch(row("Email", "Off"));
    expect(render("off", { email_announcements: false, email_promotions: true })).toMatch(row("Email", "On"));
  });
  it("is plain words: no emoji, no percent, nothing that looks like a progress bar", () => {
    const html = render("on");
    expect(html).not.toMatch(/%|role="progressbar"|<progress/);
  });
});
