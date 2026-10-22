import { beforeEach, describe, expect, it } from "vitest";
import type { NotificationChannel, NotificationKind } from "@/lib/notifications/contract";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * The two time edges the Reviewer fixed (rulings B1 and B2), probed at the
 * second so a one-minute drift cannot hide.
 *
 *   B1  Quiet hours are 22:00 INCLUSIVE to 07:00 EXCLUSIVE in the device's own
 *       zone: 21:59:59 is allowed, 22:00:00 is quiet, 06:59:59 is quiet,
 *       07:00:00 is allowed.
 *   B2  A prior claim counts toward the window only if it is STRICTLY newer
 *       than now minus the window. One exactly as old as the window no longer
 *       counts; one a second newer still does.
 */
let fake: FakeNotificationBackend;
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
});

const claim = (user: string, kind: NotificationKind, subject: string, channel: NotificationChannel, device?: string) =>
  fake.claimNotification({ p_user: user, p_kind: kind, p_subject: subject, p_channel: channel, p_device: device ?? null });

function deviceIn(timezone: string) {
  const user = fake.newId();
  fake.addPerson({ id: user });
  return { user, device: fake.addDevice({ userId: user, timezone }).id };
}

describe("B1: quiet hours are 22:00 inclusive to 07:00 exclusive, in the device's own zone", () => {
  // Africa/Lagos is UTC+1 all year, so local 22:00 is 21:00Z.
  const edges: [string, string, "quiet_hours" | null][] = [
    ["21:59:59 local is allowed", "2026-10-26T20:59:59Z", null],
    ["22:00:00 local is quiet", "2026-10-26T21:00:00Z", "quiet_hours"],
    ["06:59:59 local is quiet", "2026-10-27T05:59:59Z", "quiet_hours"],
    ["07:00:00 local is allowed", "2026-10-27T06:00:00Z", null],
  ];
  for (const [title, at, refused] of edges) {
    it(`Lagos: ${title}`, async () => {
      fake.setNow(new Date(at));
      const { user, device } = deviceIn("Africa/Lagos");
      const result = await claim(user, "match_alert", fake.newId(), "push", device);
      expect(result.refused).toBe(refused);
      expect(result.id === null).toBe(refused !== null);
    });
  }

  it("Kolkata (UTC+5:30): the same edges in its own zone, not the server's", async () => {
    const at = (iso: string) => fake.setNow(new Date(iso));
    const { user, device } = deviceIn("Asia/Kolkata");
    at("2026-10-26T16:29:59Z"); // 21:59:59 local
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).refused).toBeNull();
    at("2026-10-26T16:30:00Z"); // 22:00:00 local
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).refused).toBe("quiet_hours");
    at("2026-10-27T01:29:59Z"); // 06:59:59 local
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).refused).toBe("quiet_hours");
    at("2026-10-27T01:30:00Z"); // 07:00:00 local
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).refused).toBeNull();
  });
});

describe("B2: the claim window counts a prior claim only if it is strictly newer than now minus the window", () => {
  const HOUR = 3_600_000;

  it("push budget: a claim exactly 24 hours old no longer counts; one a second newer still does", async () => {
    const { user, device } = deviceIn("Africa/Lagos");
    for (let i = 0; i < 3; i += 1) expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).not.toBeNull();
    fake.advance(24 * HOUR - 1000); // the three claims are 23:59:59 old
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).refused).toBe("budget_cap");
    fake.advance(1000); // exactly 24 hours old
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).not.toBeNull();
  });

  it("a custom window follows the same rule at its own edge", async () => {
    const { user, device } = deviceIn("Africa/Lagos");
    for (let i = 0; i < 3; i += 1) {
      await fake.claimNotification({ p_user: user, p_kind: "match_alert", p_subject: fake.newId(), p_channel: "push", p_device: device, p_window: "2 hours" });
    }
    fake.advance(2 * HOUR - 1000);
    const at = (p_subject: string) => fake.claimNotification({ p_user: user, p_kind: "match_alert", p_subject, p_channel: "push", p_device: device, p_window: "2 hours" });
    expect((await at(fake.newId())).refused).toBe("budget_cap");
    fake.advance(1000);
    expect((await at(fake.newId())).id).not.toBeNull();
  });

  it("mass email cap: a claim exactly 24 hours old no longer counts; one a second newer still does", async () => {
    fake.putSetting("mass_email_cap_24h", 1, null);
    fake.putSetting("mass_email_ceiling_month", 100, null);
    await claim(fake.newId(), "admin_message", fake.newId(), "email");
    fake.advance(24 * HOUR - 1000);
    expect((await claim(fake.newId(), "admin_message", fake.newId(), "email")).refused).toBe("cap_24h");
    fake.advance(1000);
    expect((await claim(fake.newId(), "admin_message", fake.newId(), "email")).id).not.toBeNull();
  });
});
