import { beforeEach, describe, expect, it } from "vitest";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import type { NotificationDeliveryRow } from "@/lib/notifications/contract";

/**
 * The retention function (N1-R12, N1-R26f). The fake and the database must agree: an old, finished, non-email claim goes; an open claim, an email claim, anything inside the
 * current UTC calendar month, and anything not strictly older than the limit stays. The database PR proves the same table against the real function.
 */
const DAY = 86_400_000;
const USER = "00000000-0000-4000-8000-0000000000a1";
let fake: FakeNotificationBackend;

beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-11-20T12:00:00Z"));
});

function seed(over: Partial<NotificationDeliveryRow> & { claimed_at: string }): NotificationDeliveryRow {
  const row: NotificationDeliveryRow = {
    id: fake.newId(),
    user_id: USER,
    kind: "match_alert",
    subject_id: fake.newId(),
    device_id: null,
    channel: "inapp",
    sent_at: over.claimed_at,
    released_at: null,
    ...over,
  };
  fake.deliveries.push(row);
  return row;
}
const ids = () => fake.deliveries.map((d) => d.id);

describe("pruneNotificationDeliveries", () => {
  it("removes an old finished non-email claim (sent or released) and returns how many it removed", async () => {
    const sent = seed({ claimed_at: "2026-10-01T00:00:00Z" });
    const released = seed({ claimed_at: "2026-10-02T00:00:00Z", sent_at: null, released_at: "2026-10-02T00:01:00Z", channel: "push" });
    expect(await fake.pruneNotificationDeliveries({})).toBe(2);
    expect(ids()).not.toContain(sent.id);
    expect(ids()).not.toContain(released.id);
  });

  it("the default age is 30 days: a row 31 days old goes, a row 29 days old that is before this month stays only if it is inside the month", async () => {
    fake.setNow(new Date("2026-11-01T12:00:00Z"));
    const old = seed({ claimed_at: "2026-09-30T00:00:00Z" });
    const young = seed({ claimed_at: "2026-10-10T00:00:00Z" }); // 22 days old
    await fake.pruneNotificationDeliveries({});
    expect(ids()).not.toContain(old.id);
    expect(ids()).toContain(young.id);
  });

  it("never removes an open claim (no sent time, no release time), however old", async () => {
    const open = seed({ claimed_at: "2026-01-01T00:00:00Z", sent_at: null });
    expect(await fake.pruneNotificationDeliveries({})).toBe(0);
    expect(ids()).toContain(open.id);
  });

  it("never removes an email claim, however old and finished", async () => {
    const email = seed({ claimed_at: "2026-01-01T00:00:00Z", channel: "email", kind: "admin_message" });
    expect(await fake.pruneNotificationDeliveries({})).toBe(0);
    expect(ids()).toContain(email.id);
  });

  it("never removes a row inside the current UTC month, even when it is older than the limit", async () => {
    const inMonth = seed({ claimed_at: "2026-11-02T00:00:00Z" });
    expect(await fake.pruneNotificationDeliveries({ p_older_than_days: 1 })).toBe(0);
    expect(ids()).toContain(inMonth.id);
  });

  it("a row exactly at the first instant of the current UTC month is kept; one millisecond earlier goes", async () => {
    const atStart = seed({ claimed_at: "2026-11-01T00:00:00.000Z" });
    const before = seed({ claimed_at: "2026-10-31T23:59:59.999Z" });
    await fake.pruneNotificationDeliveries({ p_older_than_days: 1 });
    expect(ids()).toContain(atStart.id);
    expect(ids()).not.toContain(before.id);
  });

  it("the age is strict: a row exactly as old as the limit stays, one millisecond older goes", async () => {
    fake.setNow(new Date("2027-01-05T12:00:00Z")); // November is well before the current month
    const cutoff = Date.parse("2027-01-05T12:00:00Z") - 36 * DAY;
    const exactly = seed({ claimed_at: new Date(cutoff).toISOString() });
    const older = seed({ claimed_at: new Date(cutoff - 1).toISOString() });
    await fake.pruneNotificationDeliveries({ p_older_than_days: 36 });
    expect(ids()).toContain(exactly.id);
    expect(ids()).not.toContain(older.id);
  });

  it.each([0, -1, 1.5, Number.NaN, 36_501, null])("a limit of %s raises 22023", async (days) => {
    await expect(fake.pruneNotificationDeliveries({ p_older_than_days: days as number })).rejects.toMatchObject({ info: { sqlstate: "22023", code: "invalid_parameter" } });
    await expect(fake.pruneNotificationDeliveries({ p_older_than_days: days as number })).rejects.toBeInstanceOf(NotificationDbError);
  });
});
