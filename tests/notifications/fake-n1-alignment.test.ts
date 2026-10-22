import { beforeEach, describe, expect, it } from "vitest";
import { STALE_CLAIM_RESOLUTIONS } from "@/lib/notifications/contract";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import { LINK_BAD, LINK_GOOD } from "../support/n1-link-path-cases";

/**
 * Where the database author tightened a rule and the fake follows (N1-R29): the link of a message (Q2), an unknown resolution of a stale claim (Q3) and the device of a non-push claim (Q5).
 * The database tests prove the same rules against the real functions, using the SAME link cases.
 */
const UNKNOWN_LINK_ID = "no-such-link";
const ADMIN = "00000000-0000-4000-8000-0000000000b1";
const USER = "00000000-0000-4000-8000-0000000000a1";
let fake: FakeNotificationBackend;
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
  fake.addAdmin(ADMIN, "admin@example.test", ["user_messaging"]);
  fake.addPerson({ id: USER });
});

describe("Q2: the link of a draft message is a same-origin path", () => {
  it("no link is the default", () => expect(fake.addDraftMessage({ createdBy: ADMIN }).link_path).toBeNull());
  it("a null link is accepted", () => expect(fake.addDraftMessage({ createdBy: ADMIN, linkPath: null }).link_path).toBeNull());
  it.each(LINK_GOOD.map((v) => [v.slice(0, 40), v] as const))("accepts %s", (_n, value) => {
    expect(fake.addDraftMessage({ createdBy: ADMIN, linkPath: value }).link_path).toBe(value);
  });
  it.each(LINK_BAD.map(([name, v]) => [name, v] as const))("refuses %s with SQLSTATE 23514 and stores nothing", (_n, value) => {
    const before = fake.messages.length;
    let error: unknown;
    try {
      fake.addDraftMessage({ createdBy: ADMIN, linkPath: value });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(NotificationDbError);
    expect((error as NotificationDbError).info.sqlstate).toBe("23514");
    expect(fake.messages.length).toBe(before);
  });
});

describe("Q3: an unknown resolution of a stale claim is 22023 (after the permission, before the lookup)", () => {
  const stale = () => {
    const claimed = fake.deliveries;
    fake.deliveries = [...claimed, { id: fake.newId(), user_id: USER, kind: "match_alert", subject_id: fake.newId(), device_id: null, channel: "email", claimed_at: fake.now().toISOString(), sent_at: null, released_at: null }];
    return fake.deliveries[fake.deliveries.length - 1];
  };
  it("the closed list is unchanged", () => expect([...STALE_CLAIM_RESOLUTIONS]).toEqual(["mark_sent", "release_for_retry"]));
  it("an unknown resolution raises 22023 and changes nothing", async () => {
    const row = stale();
    await expect(fake.resolveStaleClaim({ p_id: row.id, p_actor: ADMIN, p_resolution: "delete_it" as never })).rejects.toMatchObject({ info: { sqlstate: "22023", code: "invalid_parameter" } });
    expect([row.sent_at, row.released_at]).toEqual([null, null]);
    expect(fake.events.filter((e) => e.event === "claim_resolved")).toHaveLength(0);
  });
  it("a null resolution raises 22023", async () => {
    const row = stale();
    await expect(fake.resolveStaleClaim({ p_id: row.id, p_actor: ADMIN, p_resolution: null as never })).rejects.toMatchObject({ info: { sqlstate: "22023" } });
  });
  it("the permission is checked first: an actor without it gets 42501 even with an unknown resolution", async () => {
    const row = stale();
    await expect(fake.resolveStaleClaim({ p_id: row.id, p_actor: USER, p_resolution: "delete_it" as never })).rejects.toMatchObject({ info: { sqlstate: "42501" } });
  });
  it("the resolution is checked before the lookup: an unknown claim with an unknown resolution is 22023, not not_found", async () => {
    await expect(fake.resolveStaleClaim({ p_id: fake.newId(), p_actor: ADMIN, p_resolution: "delete_it" as never })).rejects.toMatchObject({ info: { sqlstate: "22023" } });
  });
  it("both real resolutions still work", async () => {
    const a = stale();
    const b = stale();
    await fake.resolveStaleClaim({ p_id: a.id, p_actor: ADMIN, p_resolution: "mark_sent" });
    await fake.resolveStaleClaim({ p_id: b.id, p_actor: ADMIN, p_resolution: "release_for_retry" });
    expect(a.sent_at).not.toBeNull();
    expect(b.released_at).not.toBeNull();
  });
});

describe("Q5: a non-push claim ignores the device and stores none", () => {
  it("two e-mail claims for one event with different device ids: the second is already_claimed", async () => {
    const one = await fake.claimNotification({ p_user: USER, p_kind: "match_alert", p_subject: "00000000-0000-4000-8000-0000000000f1", p_channel: "email", p_device: "00000000-0000-4000-8000-0000000000e1" });
    const two = await fake.claimNotification({ p_user: USER, p_kind: "match_alert", p_subject: "00000000-0000-4000-8000-0000000000f1", p_channel: "email", p_device: "00000000-0000-4000-8000-0000000000e2" });
    expect(one.id).toBeTruthy();
    expect(two).toEqual({ id: null, refused: "already_claimed" });
    expect(fake.deliveries.every((d) => d.device_id === null)).toBe(true);
  });
  it("the same for in-app claims, and a made-up device is not device_unavailable for a non-push claim", async () => {
    const a = await fake.claimNotification({ p_user: USER, p_kind: "match_alert", p_subject: "00000000-0000-4000-8000-0000000000f2", p_channel: "inapp", p_device: "00000000-0000-4000-8000-0000000000e1" });
    const b = await fake.claimNotification({ p_user: USER, p_kind: "match_alert", p_subject: "00000000-0000-4000-8000-0000000000f2", p_channel: "inapp" });
    expect(a.id).toBeTruthy();
    expect(b.refused).toBe("already_claimed");
  });
  it("a push claim still stores its device", async () => {
    const dev = fake.addDevice({ userId: USER });
    const res = await fake.claimNotification({ p_user: USER, p_kind: "match_alert", p_subject: "00000000-0000-4000-8000-0000000000f3", p_channel: "push", p_device: dev.id });
    expect(res.id).toBeTruthy();
    expect(fake.deliveries.find((d) => d.id === res.id)?.device_id).toBe(dev.id);
  });
});

describe("commit 4: the stream unsubscribe and the device registration refuse what the database refuses", () => {
  const refusalOf = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (e) {
      return e instanceof NotificationDbError ? `${e.info.sqlstate}/${e.info.code}` : String(e);
    }
    return "NOT REFUSED";
  };
  it.each([["an unknown stream", "newsletters"], ["a null stream", null], ["an empty stream", ""], ["a stream in the wrong case", "Promotions"]])("%s is 22023, whether or not the token matches", async (_n, stream) => {
    fake.addPerson({ id: "00000000-0000-4000-8000-0000000000a9", unsubscribeToken: "tok-1" });
    for (const token of ["tok-1", UNKNOWN_LINK_ID, null]) {
      expect(await refusalOf(() => fake.emailUnsubscribeStream({ p_token: token as string, p_stream: stream as never, p_subscribed: false })), String(token)).toBe("22023/invalid_parameter");
    }
  });
  it("an unknown token with a known stream is matched = false and no error", async () => {
    expect(await fake.emailUnsubscribeStream({ p_token: UNKNOWN_LINK_ID, p_stream: "promotions", p_subscribed: true })).toEqual({ matched: false });
  });
  it.each(["p_endpoint", "p_p256dh", "p_auth", "p_ua"])("a null %s is 22023 (the function is not strict), before any other check", async (field) => {
    const args = { p_endpoint: "http://not-https.example.invalid/x", p_p256dh: "k", p_auth: "a", p_ua: "Chrome", p_timezone: "Mars/Olympus", [field]: null };
    expect(await refusalOf(() => fake.forCaller(USER).registerPushSubscription(args as never))).toBe("22023/invalid_parameter");
  });
});

describe("prepare raises requires_approval (a promotion, or more than 100 recipients) and never lowers it", () => {
  const prepare = async (opts: { kind?: "promotion" | "service_announcement"; requiresApproval: boolean; people: number }) => {
    for (let i = 0; i < opts.people; i++) fake.addPerson({ id: `00000000-0000-4000-8000-0000000${String(i + 100).padStart(5, "0")}` });
    fake.setFlag("notifications_master", true);
    fake.setFlag("admin_messaging", true);
    fake.setFlag("admin_promotions", true);
    const m = fake.addDraftMessage({ createdBy: ADMIN, kind: opts.kind ?? "service_announcement", requiresApproval: opts.requiresApproval, segmentKey: "everyone", consentLine: "You asked for offers." });
    const count = await fake.prepareAdminMessage({ p_message: m.id, p_actor: ADMIN, p_max_audience: 500 });
    return { count, flag: fake.messages.find((x) => x.id === m.id)!.requires_approval };
  };
  it("an announcement to a few people keeps false", async () => expect((await prepare({ requiresApproval: false, people: 3 })).flag).toBe(false));
  it("a promotion gets true", async () => expect((await prepare({ kind: "promotion", requiresApproval: false, people: 3 })).flag).toBe(true));
  it("exactly 100 recipients keep false; 101 get true", async () => {
    // beforeEach already holds one person (USER), so 99 more make 100 and 100 more make 101
    expect(await prepare({ requiresApproval: false, people: 99 })).toEqual({ count: 100, flag: false });
  });
  it("101 recipients get true", async () => expect(await prepare({ requiresApproval: false, people: 100 })).toEqual({ count: 101, flag: true }));
  it("a message that already needs approval is never lowered", async () => expect((await prepare({ requiresApproval: true, people: 2 })).flag).toBe(true));
});
