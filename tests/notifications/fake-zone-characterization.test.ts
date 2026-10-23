import { describe, expect, it } from "vitest";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * CHARACTERIZATION of the fake's local-time and time-zone logic, written BEFORE that logic was moved behind src/lib/format/datetime.ts so that the move provably changes nothing.
 *
 * It goes only through the fake's public behaviour: a push claim is refused with `quiet_hours` when the device's own local time is 22:00 (inclusive) to 07:00 (exclusive), and
 * registering a device accepts a zone the runtime knows and refuses any other with 22023. Nothing here knows how the hour is computed.
 */
const claimAt = async (zone: string, iso: string) => {
  const fake = new FakeNotificationBackend(new Date(iso));
  const user = fake.newId();
  fake.addPerson({ id: user });
  const device = fake.addDevice({ userId: user, timezone: zone }).id;
  const result = await fake.claimNotification({ p_user: user, p_kind: "match_alert", p_subject: fake.newId(), p_channel: "push", p_device: device });
  return result.refused;
};
const quiet = async (zone: string, iso: string) => (await claimAt(zone, iso)) === "quiet_hours";

/** [zone, instant, quiet?, what the local time is] */
const EDGES: [string, string, boolean, string][] = [
  ["Africa/Lagos", "2026-10-26T20:59:59Z", false, "21:59:59"],
  ["Africa/Lagos", "2026-10-26T21:00:00Z", true, "22:00:00"],
  ["Africa/Lagos", "2026-10-27T05:59:59Z", true, "06:59:59"],
  ["Africa/Lagos", "2026-10-27T06:00:00Z", false, "07:00:00"],
  ["Asia/Kolkata", "2026-10-26T16:29:59Z", false, "21:59:59"],
  ["Asia/Kolkata", "2026-10-26T16:30:00Z", true, "22:00:00"],
  ["Asia/Kolkata", "2026-10-27T01:29:59Z", true, "06:59:59"],
  ["Asia/Kolkata", "2026-10-27T01:30:00Z", false, "07:00:00"],
  // America/Los_Angeles, clocks go BACK at 09:00Z on 2026-11-01 (PDT, UTC-7, to PST, UTC-8)
  ["America/Los_Angeles", "2026-11-01T04:59:59Z", false, "21:59:59 PDT (31 Oct)"],
  ["America/Los_Angeles", "2026-11-01T05:00:00Z", true, "22:00:00 PDT (31 Oct)"],
  ["America/Los_Angeles", "2026-11-01T08:59:59Z", true, "01:59:59 PDT"],
  ["America/Los_Angeles", "2026-11-01T09:00:00Z", true, "01:00:00 PST (the repeated hour)"],
  ["America/Los_Angeles", "2026-11-01T14:59:59Z", true, "06:59:59 PST"],
  ["America/Los_Angeles", "2026-11-01T15:00:00Z", false, "07:00:00 PST"],
  ["America/Los_Angeles", "2026-11-02T05:59:59Z", false, "21:59:59 PST"],
  ["America/Los_Angeles", "2026-11-02T06:00:00Z", true, "22:00:00 PST"],
  // clocks go FORWARD at 10:00Z on 2026-03-08 (PST, UTC-8, to PDT, UTC-7)
  ["America/Los_Angeles", "2026-03-08T13:59:59Z", true, "06:59:59 PDT"],
  ["America/Los_Angeles", "2026-03-08T14:00:00Z", false, "07:00:00 PDT"],
  ["America/Los_Angeles", "2026-03-08T04:59:59Z", false, "20:59:59 PST (7 Mar)"],
  ["UTC", "2026-10-26T21:59:59Z", false, "21:59:59"],
  ["UTC", "2026-10-26T22:00:00Z", true, "22:00:00"],
  ["Asia/Kathmandu", "2026-10-26T16:14:59Z", false, "21:59:59 (UTC+5:45)"],
  ["Asia/Kathmandu", "2026-10-26T16:15:00Z", true, "22:00:00 (UTC+5:45)"],
];

describe("quiet hours at the edges, in each device's own zone", () => {
  it.each(EDGES)("%s at %s: quiet=%s (%s local)", async (zone, iso, expected) => {
    expect(await quiet(zone, iso)).toBe(expected);
    // and a claim that is not quiet is a claim, never some other refusal
    if (!expected) expect(await claimAt(zone, iso)).toBeNull();
  });
});

describe("quiet hours across a whole day, by fixed offset", () => {
  it.each([
    ["Africa/Lagos", 1],
    ["Asia/Kolkata", 5.5],
    ["Asia/Tokyo", 9],
    ["Etc/GMT+5", -5],
  ])("%s (UTC%s) at half past every local hour", async (zone, offsetHours) => {
    for (let k = 0; k < 24; k += 1) {
      const instant = new Date(Date.UTC(2026, 9, 26, 0, 0, 0) + k * 3_600_000 + 30 * 60_000 - (offsetHours % 1) * 3_600_000);
      const localHour = Math.floor((((instant.getUTCHours() + instant.getUTCMinutes() / 60 + offsetHours) % 24) + 24) % 24);
      const expected = localHour >= 22 || localHour < 7;
      expect(await quiet(zone, instant.toISOString()), `${zone} ${instant.toISOString()} local hour ${localHour}`).toBe(expected);
    }
  });
});

describe("time-zone validity at registration", () => {
  const register = (timezone?: string | null) => {
    const fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
    const user = fake.newId();
    return { fake, call: fake.forCaller(user).registerPushSubscription({ p_endpoint: "https://fcm.googleapis.com/fcm/send/x", p_p256dh: "k", p_auth: "a", p_ua: "Chrome", p_timezone: timezone }) };
  };

  it("an invalid name is refused with 22023 and nothing is stored", async () => {
    for (const bad of ["Mars/Olympus", "Not A Zone", "Africa/Nowhere", "12345"]) {
      const { fake, call } = register(bad);
      const error = (await call.catch((e: unknown) => e)) as NotificationDbError;
      expect(error, bad).toBeInstanceOf(NotificationDbError);
      expect(error.info, bad).toMatchObject({ code: "invalid_parameter", sqlstate: "22023" });
      expect(fake.devices, bad).toHaveLength(0);
    }
  });

  it("a name the runtime knows is accepted and stored as given", async () => {
    for (const good of ["Asia/Kolkata", "America/Los_Angeles", "Europe/London", "UTC", "Africa/Lagos", "africa/lagos"]) {
      const { fake, call } = register(good);
      await call;
      expect(fake.devices.map((d) => d.timezone), good).toEqual([good]);
    }
  });

  it("an absent or empty name is stored as Africa/Lagos", async () => {
    for (const absent of [undefined, null, ""]) {
      const { fake, call } = register(absent);
      await call;
      expect(fake.devices.map((d) => d.timezone)).toEqual(["Africa/Lagos"]);
    }
  });

  it("a device that is already stored with a name the runtime does not know makes the claim fail with a RangeError (not a quiet-hours answer)", async () => {
    const fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
    const user = fake.newId();
    fake.addPerson({ id: user });
    const device = fake.addDevice({ userId: user, timezone: "Mars/Olympus" }).id;
    await expect(fake.claimNotification({ p_user: user, p_kind: "match_alert", p_subject: fake.newId(), p_channel: "push", p_device: device })).rejects.toBeInstanceOf(RangeError);
  });
});
