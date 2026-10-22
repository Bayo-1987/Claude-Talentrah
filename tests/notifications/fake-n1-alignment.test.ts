import { beforeEach, describe, expect, it } from "vitest";
import { STALE_CLAIM_RESOLUTIONS, type AdminSegmentParams } from "@/lib/notifications/contract";
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
    fake.deliveries = [...claimed, { id: fake.newId(), user_id: USER, kind: "match_alert", subject_id: fake.newId(), device_id: null, channel: "email", claimed_at: new Date(fake.now().getTime() - 2 * 3600_000).toISOString(), sent_at: null, released_at: null }];
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

describe("N1-R31: stale resolution is for old e-mail claims only (F6), and the daily limits hold at start (F1)", () => {
  const claimRow = (channel: "email" | "push" | "inapp", ageMs: number) => {
    fake.deliveries.push({ id: fake.newId(), user_id: USER, kind: "match_alert", subject_id: fake.newId(), device_id: null, channel, claimed_at: new Date(fake.now().getTime() - ageMs).toISOString(), sent_at: null, released_at: null });
    return fake.deliveries[fake.deliveries.length - 1];
  };
  const refused = (p: Promise<unknown>) => p.then(() => "NOT REFUSED", (e: NotificationDbError) => `${e.info.sqlstate}/${e.info.reason}`);
  it("a fresh e-mail claim (29 minutes), an old push claim and an old in-app claim are refused invalid_state", async () => {
    for (const row of [claimRow("email", 29 * 60_000), claimRow("push", 5 * 3600_000), claimRow("inapp", 5 * 3600_000)]) {
      expect(await refused(fake.resolveStaleClaim({ p_id: row.id, p_actor: ADMIN, p_resolution: "mark_sent" }))).toBe("P0001/invalid_state");
      expect(row.sent_at).toBeNull();
    }
  });
  it("an e-mail claim open for 31 minutes can be resolved", async () => {
    const row = claimRow("email", 31 * 60_000);
    await fake.resolveStaleClaim({ p_id: row.id, p_actor: ADMIN, p_resolution: "mark_sent" });
    expect(row.sent_at).not.toBeNull();
  });
  const flagsOn = () => (["notifications_master", "admin_messaging", "admin_promotions", "admin_email"] as const).forEach((k) => fake.setFlag(k, true));
  const startable = (createdBy: string) => fake.addDraftMessage({ createdBy, requiresApproval: false });
  const asPrepared = (m: { status: string }) => { m.status = "prepared"; };
  it("a sixth start by one creator inside 24 hours is operator_daily_limit; an eleventh overall is overall_daily_limit; older starts do not count", async () => {
    flagsOn();
    fake.addAdmin(NEW_ADMIN, "b@example.test", ["user_messaging"]);
    for (let i = 0; i < 5; i++) { const m = startable(ADMIN); asPrepared(m); m.sent_started_at = new Date(fake.now().getTime() - 3600_000).toISOString(); m.status = "sent"; }
    const sixth = startable(ADMIN); asPrepared(sixth);
    expect(await refused(fake.startAdminMessageSend({ p_message: sixth.id, p_actor: ADMIN }))).toBe("P0001/operator_daily_limit");
    expect(sixth.status).toBe("prepared");
    const other = startable(NEW_ADMIN); asPrepared(other);
    expect(await fake.startAdminMessageSend({ p_message: other.id, p_actor: NEW_ADMIN })).toBe(other.id);
  });
  it("starts older than 24 hours do not count", async () => {
    flagsOn();
    for (let i = 0; i < 5; i++) { const m = startable(ADMIN); m.sent_started_at = new Date(fake.now().getTime() - 25 * 3600_000).toISOString(); m.status = "sent"; }
    const next = startable(ADMIN); asPrepared(next);
    expect(await fake.startAdminMessageSend({ p_message: next.id, p_actor: ADMIN })).toBe(next.id);
  });
  it("a message that cannot start gets null, not a limit error", async () => {
    flagsOn();
    for (let i = 0; i < 5; i++) { const m = startable(ADMIN); m.sent_started_at = new Date(fake.now().getTime() - 3600_000).toISOString(); m.status = "sent"; }
    const draft = startable(ADMIN);
    expect(await fake.startAdminMessageSend({ p_message: draft.id, p_actor: ADMIN })).toBeNull();
  });
});
const NEW_ADMIN = "00000000-0000-4000-8000-0000000000b2";

describe("F7: the inactive-seekers days value is an integer 30, 60 or 90 in the contract type, the fake and (by migration-0265-admin-functions.test.ts) the SQL", () => {
  it("the contract type accepts 30, 60 and 90 and nothing else (checked by tsc)", () => {
    const ok: AdminSegmentParams[] = [{ days: 30 }, { days: 60 }, { days: 90 }];
    // @ts-expect-error 45 is not a window
    const bad45: AdminSegmentParams = { days: 45 };
    // @ts-expect-error a fraction is not a window
    const bad305: AdminSegmentParams = { days: 30.5 };
    expect(ok).toHaveLength(3);
    expect([bad45, bad305]).toHaveLength(2);
  });
  const run = (days: unknown) => fake.resolveAdminSegment({ p_key: "inactive_seekers", p_params: { days } as never, p_actor: ADMIN });
  it("the fake accepts 30, 60 and 90", async () => {
    for (const d of [30, 60, 90]) await expect(run(d)).resolves.toEqual([]);
  });
  it.each([[30.5], [45], ["30"], [null], [0], [-30]])("the fake refuses %s with 22023", async (d) => {
    await expect(run(d)).rejects.toMatchObject({ info: { sqlstate: "22023", code: "invalid_parameter" } });
  });
  // JSON has one number 30: the text 30.0 reaches the fake as 30 (JavaScript cannot tell them apart), so only the database sees the difference and refuses it (22023, never 22P02).
});
