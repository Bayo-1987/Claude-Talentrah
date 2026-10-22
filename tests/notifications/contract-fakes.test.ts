import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  NOTIFICATION_FLAGS,
  type ClaimNotificationArgs,
  type NotificationChannel,
  type NotificationKind,
} from "@/lib/notifications/contract";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend, FakePushSender } from "@/lib/notifications/fakes";

/**
 * The fakes enforce the rules the prompt states, so a builder working against
 * them meets the same refusals the database will give. Each test is a rule from
 * the prompt's test list; the database PR proves the real functions the same way.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let fake: FakeNotificationBackend;
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z")); // 13:00 in Lagos
});

const claim = (
  user: string,
  kind: NotificationKind,
  subject: string,
  channel: NotificationChannel,
  device?: string,
  window?: string,
) => fake.claimNotification({ p_user: user, p_kind: kind, p_subject: subject, p_channel: channel, p_device: device ?? null, p_window: window });

const refusalOf = async (promise: Promise<unknown>) => ((await promise.catch((e: unknown) => e)) as NotificationDbError).info;

function personWithDevice(timezone = "Africa/Lagos") {
  const user = fake.newId();
  fake.addPerson({ id: user });
  const device = fake.addDevice({ userId: user, timezone });
  return { user, device: device.id };
}

describe("the ledger", () => {
  it("the same claim twice returns one row", async () => {
    const { user } = personWithDevice();
    const subject = fake.newId();
    expect((await claim(user, "match_alert", subject, "inapp")).id).not.toBeNull();
    expect((await claim(user, "match_alert", subject, "inapp")).id).toBeNull();
    expect(fake.deliveries).toHaveLength(1);
  });

  it("application_viewed is claimed once per application", async () => {
    const { user } = personWithDevice();
    const application = fake.newId();
    expect((await claim(user, "application_viewed", application, "inapp")).id).not.toBeNull();
    expect((await claim(user, "application_viewed", application, "inapp")).id).toBeNull();
    expect((await claim(user, "application_viewed", fake.newId(), "inapp")).id).not.toBeNull();
  });

  it("a released push claim can be claimed again", async () => {
    const { user, device } = personWithDevice();
    const subject = fake.newId();
    const first = await claim(user, "match_alert", subject, "push", device);
    await fake.releaseNotification({ p_id: first.id!, p_reason: "gone" });
    expect((await claim(user, "match_alert", subject, "push", device)).id).not.toBeNull();
  });

  it("an email claim cannot be released by the release function", async () => {
    const { user } = personWithDevice();
    const row = await claim(user, "admin_message", fake.newId(), "email");
    const info = await refusalOf(fake.releaseNotification({ p_id: row.id!, p_reason: "gone" }));
    expect(info).toMatchObject({ code: "refused", reason: "email_release_refused" });
    expect(fake.deliveries[0].released_at).toBeNull();
  });

  it("a push release needs a reason from the closed list", async () => {
    const { user, device } = personWithDevice();
    const row = await claim(user, "match_alert", fake.newId(), "push", device);
    const info = await refusalOf(fake.releaseNotification({ p_id: row.id!, p_reason: "timeout" as never }));
    expect(info.reason).toBe("invalid_release_reason");
  });

  it("a stale email claim is not released by any automatic path and is not re-sent by a retry", async () => {
    const { user } = personWithDevice();
    const message = fake.newId();
    await claim(user, "admin_message", message, "email");
    fake.advance(40 * DAY);

    expect(await fake.staleNotificationClaims({ p_channel: "email", p_older_than: "1 hour" })).toHaveLength(1);
    expect((await claim(user, "admin_message", message, "email")).id).toBeNull(); // a retry skips it
    expect(fake.deliveries[0]).toMatchObject({ sent_at: null, released_at: null });
  });

  it("resolving a stale claim needs the permission and writes an audit event with only the resolution", async () => {
    const { user } = personWithDevice();
    const admin = fake.newId();
    fake.addAdmin(admin, "ops@example.test", ["user_messaging"]);
    const outsider = fake.newId();
    fake.addAdmin(outsider, "other@example.test", []);
    const message = fake.newId();
    const row = await claim(user, "admin_message", message, "email");

    const info = await refusalOf(fake.resolveStaleClaim({ p_id: row.id!, p_actor: outsider, p_resolution: "mark_sent" }));
    expect(info.code).toBe("permission_denied");
    expect(fake.events).toHaveLength(0);

    await fake.resolveStaleClaim({ p_id: row.id!, p_actor: admin, p_resolution: "release_for_retry" });
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ event: "claim_resolved", detail: { resolution: "release_for_retry" }, actor_email: "ops@example.test" });
    expect(Object.keys(fake.events[0].detail)).toEqual(["resolution"]);
    expect((await claim(user, "admin_message", message, "email")).id).not.toBeNull(); // released for retry
  });

  it("a stale push claim is not re-sent and ages out of the cap window", async () => {
    const { user, device } = personWithDevice();
    for (let i = 0; i < 3; i += 1) expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).not.toBeNull();
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).toBeNull();
    fake.advance(25 * HOUR);
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).not.toBeNull();
  });

  it("the claim takes no budget argument: the budget is decided from the kind inside", () => {
    expectTypeOf<keyof ClaimNotificationArgs>().toEqualTypeOf<
      "p_user" | "p_kind" | "p_subject" | "p_channel" | "p_device" | "p_window"
    >();
  });
});

describe("push budgets", () => {
  it("the user-event cap: the fourth push claim in the window returns nothing", async () => {
    const { user, device } = personWithDevice();
    const kinds: NotificationKind[] = ["new_applicant", "application_viewed", "match_alert"];
    for (const kind of kinds) expect((await claim(user, kind, fake.newId(), "push", device)).id).not.toBeNull();
    expect((await claim(user, "new_applicant", fake.newId(), "push", device)).id).toBeNull();
  });

  it("after an admin push, a new-applicant push is still allowed up to the user-event cap of 3", async () => {
    const { user, device } = personWithDevice();
    expect((await claim(user, "admin_message", fake.newId(), "push", device)).id).not.toBeNull();
    for (let i = 0; i < 3; i += 1) expect((await claim(user, "new_applicant", fake.newId(), "push", device)).id).not.toBeNull();
    expect((await claim(user, "new_applicant", fake.newId(), "push", device)).id).toBeNull();
  });

  it("after three user-event pushes an admin push is still allowed", async () => {
    const { user, device } = personWithDevice();
    for (let i = 0; i < 3; i += 1) await claim(user, "match_alert", fake.newId(), "push", device);
    expect((await claim(user, "admin_message", fake.newId(), "push", device)).id).not.toBeNull();
  });

  it("a second admin push to the same person inside 24 hours is refused", async () => {
    const { user, device } = personWithDevice();
    await claim(user, "admin_message", fake.newId(), "push", device);
    expect((await claim(user, "admin_message", fake.newId(), "push", device)).id).toBeNull();
  });

  it("a person with two devices counts once per event", async () => {
    const { user, device } = personWithDevice();
    const second = fake.addDevice({ userId: user }).id;
    const event = fake.newId();
    expect((await claim(user, "match_alert", event, "push", device)).id).not.toBeNull();
    expect((await claim(user, "match_alert", event, "push", second)).id).not.toBeNull();
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).not.toBeNull();
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).not.toBeNull(); // third distinct event
    expect((await claim(user, "match_alert", fake.newId(), "push", device)).id).toBeNull(); // fourth
  });

  it("a released claim does not count toward the cap", async () => {
    const { user, device } = personWithDevice();
    const first = await claim(user, "admin_message", fake.newId(), "push", device);
    await fake.releaseNotification({ p_id: first.id!, p_reason: "retries_exhausted" });
    expect((await claim(user, "admin_message", fake.newId(), "push", device)).id).not.toBeNull();
  });

  it("a revoked device, or one that belongs to someone else, cannot be claimed", async () => {
    const mine = personWithDevice();
    const other = personWithDevice();
    fake.devices.find((d) => d.id === mine.device)!.revoked_at = fake.now().toISOString();
    expect((await claim(mine.user, "match_alert", fake.newId(), "push", mine.device)).id).toBeNull();
    expect((await claim(mine.user, "match_alert", fake.newId(), "push", other.device)).id).toBeNull();
  });
});

describe("per-device quiet hours (22:00 to 07:00 in the device's own zone)", () => {
  it("at 23:00 in Lagos a Lagos device is refused and a Los Angeles device is allowed", async () => {
    fake.setNow(new Date("2026-10-26T22:00:00Z")); // 23:00 Lagos, 15:00 Los Angeles
    const lagos = personWithDevice("Africa/Lagos");
    const la = personWithDevice("America/Los_Angeles");
    expect((await claim(lagos.user, "match_alert", fake.newId(), "push", lagos.device)).id).toBeNull();
    expect((await claim(la.user, "match_alert", fake.newId(), "push", la.device)).id).not.toBeNull();
  });

  it("a device in Asia/Kolkata is evaluated by its own local time", async () => {
    const kolkata = personWithDevice("Asia/Kolkata");
    fake.setNow(new Date("2026-10-26T02:00:00Z")); // 07:30 in Kolkata, 03:00 in Lagos
    expect((await claim(kolkata.user, "match_alert", fake.newId(), "push", kolkata.device)).id).not.toBeNull();
    fake.setNow(new Date("2026-10-26T17:00:00Z")); // 22:30 in Kolkata
    expect((await claim(kolkata.user, "new_applicant", fake.newId(), "push", kolkata.device)).id).toBeNull();
  });

  it("quiet hours are right on a daylight-saving change day", async () => {
    const la = personWithDevice("America/Los_Angeles");
    // Clocks go back at 09:00Z on 1 Nov 2026, so 14:00Z is 06:00 local (quiet) and 15:00Z is 07:00 local.
    fake.setNow(new Date("2026-11-01T14:00:00Z"));
    expect((await claim(la.user, "match_alert", fake.newId(), "push", la.device)).id).toBeNull();
    fake.setNow(new Date("2026-11-01T15:00:00Z"));
    expect((await claim(la.user, "match_alert", fake.newId(), "push", la.device)).id).not.toBeNull();
  });

  it("the zone comes from the stored device; the caller cannot supply one", async () => {
    fake.setNow(new Date("2026-10-26T22:00:00Z"));
    const lagos = personWithDevice("Africa/Lagos");
    const args = { p_user: lagos.user, p_kind: "match_alert", p_subject: fake.newId(), p_channel: "push", p_device: lagos.device, p_timezone: "America/Los_Angeles" };
    // An extra argument is ignored: the stored Lagos zone still applies.
    expect((await fake.claimNotification(args as ClaimNotificationArgs)).id).toBeNull();
  });

  it("with two devices in different zones the event reaches only the one outside quiet hours and counts once", async () => {
    fake.setNow(new Date("2026-10-26T22:00:00Z"));
    const user = fake.newId();
    fake.addPerson({ id: user });
    const lagos = fake.addDevice({ userId: user, timezone: "Africa/Lagos" }).id;
    const la = fake.addDevice({ userId: user, timezone: "America/Los_Angeles" }).id;
    const event = fake.newId();
    expect((await claim(user, "match_alert", event, "push", lagos)).id).toBeNull();
    expect((await claim(user, "match_alert", event, "push", la)).id).not.toBeNull();
    expect(fake.deliveries).toHaveLength(1);
  });
});

describe("the mass-email cap and the monthly ceiling", () => {
  const emailClaim = (user = fake.newId()) => claim(user, "admin_message", fake.newId(), "email");

  it("counts a rolling 24 hours, not a calendar day", async () => {
    fake.putSetting("mass_email_cap_24h", 2, null);
    fake.setNow(new Date("2026-10-26T23:00:00Z"));
    await emailClaim();
    await emailClaim();
    fake.setNow(new Date("2026-10-27T01:00:00Z")); // a new calendar day, 2 hours later
    expect(await emailClaim()).toEqual({ id: null, refused: "cap_24h" });
    fake.setNow(new Date("2026-10-27T23:30:00Z")); // 24.5 hours after the first
    expect((await emailClaim()).id).not.toBeNull();
  });

  it("returns nothing and inserts nothing when the cap is reached", async () => {
    fake.putSetting("mass_email_cap_24h", 1, null);
    await emailClaim();
    const before = fake.deliveries.length;
    expect((await emailClaim()).id).toBeNull();
    expect(fake.deliveries).toHaveLength(before);
  });

  it("a missing setting means cap 0 and ceiling 0", async () => {
    fake.removeSetting("mass_email_cap_24h");
    expect(await emailClaim()).toEqual({ id: null, refused: "cap_24h" });
    fake.putSetting("mass_email_cap_24h", 100, null);
    fake.removeSetting("mass_email_ceiling_month");
    expect(await emailClaim()).toEqual({ id: null, refused: "ceiling_month" });
  });

  it("the ceiling counts the UTC calendar month and starts again on the 1st", async () => {
    fake.putSetting("mass_email_cap_24h", 100, null);
    fake.putSetting("mass_email_ceiling_month", 2, null);
    fake.setNow(new Date("2026-10-30T10:00:00Z"));
    await emailClaim();
    await emailClaim();
    fake.setNow(new Date("2026-10-31T23:59:00Z"));
    expect(await emailClaim()).toEqual({ id: null, refused: "ceiling_month" });
    fake.setNow(new Date("2026-11-01T00:01:00Z"));
    expect((await emailClaim()).id).not.toBeNull();
  });

  it("counts only admin_message email claims, never other kinds or channels", async () => {
    fake.putSetting("mass_email_cap_24h", 1, null);
    await claim(fake.newId(), "match_alert", fake.newId(), "email");
    await claim(fake.newId(), "admin_message", fake.newId(), "inapp");
    expect((await emailClaim()).id).not.toBeNull();
  });

  it("raising the cap, as an operator with the permission, lets the next claim succeed and logs the change", async () => {
    const operator = fake.newId();
    fake.addAdmin(operator, "root@example.test", ["operators"]);
    fake.putSetting("mass_email_cap_24h", 1, null);
    await emailClaim();
    expect((await emailClaim()).refused).toBe("cap_24h");
    await fake.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 5, p_actor: operator });
    expect((await emailClaim()).id).not.toBeNull();
    expect(fake.settingChanges).toEqual([
      expect.objectContaining({ key: "mass_email_cap_24h", old_value: 1, new_value: 5, actor_email: "root@example.test" }),
    ]);
  });

  it("only the operators permission changes a setting, and the value is bounded", async () => {
    const messenger = fake.newId();
    fake.addAdmin(messenger, "m@example.test", ["user_messaging"]);
    const operator = fake.newId();
    fake.addAdmin(operator, "root@example.test", ["operators"]);
    expect((await refusalOf(fake.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 5, p_actor: messenger }))).code).toBe("permission_denied");
    for (const value of [-1, 10001, 1.5]) {
      expect((await refusalOf(fake.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: value, p_actor: operator }))).reason).toBe("setting_value_out_of_range");
    }
    expect((await refusalOf(fake.setNotificationSetting({ p_key: "other" as never, p_value: 5, p_actor: operator }))).reason).toBe("setting_key_unknown");
    expect(fake.settingChanges).toHaveLength(0);
  });
});

describe("push devices", () => {
  const register = (user: string, overrides: Partial<Parameters<ReturnType<FakeNotificationBackend["forCaller"]>["registerPushSubscription"]>[0]> = {}) =>
    fake.forCaller(user).registerPushSubscription({
      p_endpoint: `https://push.example.invalid/${fake.newId()}`,
      p_p256dh: "k",
      p_auth: "a",
      p_ua: "Chrome on Android",
      ...overrides,
    });

  it("rejects a non-https endpoint and an oversize one", async () => {
    const user = fake.newId();
    expect((await refusalOf(register(user, { p_endpoint: "http://push.example.invalid/x" }))).reason).toBe("not_https");
    expect((await refusalOf(register(user, { p_endpoint: `https://push.example.invalid/${"x".repeat(3000)}` }))).reason).toBe("value_too_long");
    expect((await refusalOf(register(user, { p_ua: "x".repeat(41) }))).reason).toBe("value_too_long");
  });

  it("an eleventh active device is refused", async () => {
    const user = fake.newId();
    for (let i = 0; i < 10; i += 1) await register(user);
    expect((await refusalOf(register(user))).reason).toBe("device_limit");
  });

  it("a time zone that is not an IANA name is refused with 22023, never replaced", async () => {
    const user = fake.newId();
    const info = await refusalOf(register(user, { p_timezone: "Mars/Olympus" }));
    expect(info).toMatchObject({ code: "invalid_parameter", sqlstate: "22023" });
    expect(fake.devices).toHaveLength(0);
  });

  it("an absent or empty time zone is stored as Africa/Lagos", async () => {
    const user = fake.newId();
    await register(user);
    await register(user, { p_timezone: "" });
    await register(user, { p_timezone: null });
    expect(fake.devices.map((d) => d.timezone)).toEqual(["Africa/Lagos", "Africa/Lagos", "Africa/Lagos"]);
  });

  it("registering an existing endpoint as a different person takes it from the previous owner", async () => {
    const first = fake.newId();
    const second = fake.newId();
    const endpoint = "https://push.example.invalid/shared";
    await register(first, { p_endpoint: endpoint });
    await register(second, { p_endpoint: endpoint });
    expect(fake.devices.filter((d) => d.endpoint === endpoint)).toHaveLength(1);
    expect(fake.devices.find((d) => d.endpoint === endpoint)?.user_id).toBe(second);
  });

  it("a deletion request revokes the person's devices", async () => {
    const user = fake.newId();
    fake.addPerson({ id: user });
    await register(user);
    fake.requestDeletion(user);
    expect(fake.devices[0]).toMatchObject({ revoke_reason: "deleted" });
    expect(fake.devices[0].revoked_at).not.toBeNull();
  });
});

describe("preferences and the unread count", () => {
  it("a new person has every push switch and email_promotions off, email_announcements on", () => {
    const person = fake.addPerson({ id: fake.newId() });
    expect(person.prefs).toEqual({
      push_enabled: false, push_new_applicant: false, push_application_viewed: false, push_match_alert: false,
      push_promotions: false, email_promotions: false, email_announcements: true,
    });
  });

  it("the unsubscribe-stream function sets the right column with a valid token and reports matched=false otherwise", async () => {
    const id = fake.newId();
    fake.addPerson({ id, unsubscribeToken: "tok", prefs: { email_promotions: true } });
    expect(await fake.emailUnsubscribeStream({ p_token: "tok", p_stream: "promotions" })).toEqual({ matched: true });
    expect(fake.person(id)!.prefs).toMatchObject({ email_promotions: false, email_announcements: true });
    expect(await fake.emailUnsubscribeStream({ p_token: "tok", p_stream: "announcements" })).toEqual({ matched: true });
    expect(fake.person(id)!.prefs.email_announcements).toBe(false);
    expect(await fake.emailUnsubscribeStream({ p_token: "nope", p_stream: "announcements" })).toEqual({ matched: false });
  });

  it("counts only the person's own unread items", async () => {
    const a = fake.newId();
    const b = fake.newId();
    fake.addInboxItem(a);
    fake.addInboxItem(a, true);
    fake.addInboxItem(b);
    expect(await fake.unreadNotificationCount({ p_user: a })).toBe(1);
  });
});

describe("admin messaging", () => {
  let sender: string;
  let approver: string;
  beforeEach(() => {
    sender = fake.newId();
    approver = fake.newId();
    fake.addAdmin(sender, "sender@example.test", ["user_messaging"]);
    fake.addAdmin(approver, "approver@example.test", ["user_messaging"]);
    for (const key of [NOTIFICATION_FLAGS.master, NOTIFICATION_FLAGS.adminMessaging, NOTIFICATION_FLAGS.adminPromotions, NOTIFICATION_FLAGS.adminEmail]) {
      fake.setFlag(key, true);
    }
  });

  async function preparedMessage(input: Parameters<FakeNotificationBackend["addDraftMessage"]>[0] = { createdBy: sender }) {
    const message = fake.addDraftMessage({ ...input, createdBy: input.createdBy ?? sender });
    await fake.prepareAdminMessage({ p_message: message.id, p_actor: sender, p_max_audience: 500 });
    return message;
  }

  it("an operator without user_messaging is refused by every admin function", async () => {
    const outsider = fake.newId();
    fake.addAdmin(outsider, "x@example.test", ["operators"]);
    const message = fake.addDraftMessage({ createdBy: sender });
    const ids = { p_message: message.id, p_actor: outsider };
    const calls: Promise<unknown>[] = [
      fake.resolveAdminSegment({ p_actor: outsider, p_key: "everyone", p_params: {} }),
      fake.prepareAdminMessage({ ...ids, p_max_audience: 500 }),
      fake.submitAdminMessage(ids),
      fake.approveAdminMessage({ ...ids, p_kind_confirmed: "service_announcement" }),
      fake.cancelAdminMessage(ids),
      fake.startAdminMessageSend(ids),
      fake.adminMessageAudit({ p_actor: outsider }),
      fake.recordAdminMessageTest(ids),
      fake.resumeAdminMessageSend(ids),
      fake.resolveStaleClaim({ p_id: fake.newId(), p_actor: outsider, p_resolution: "mark_sent" }),
    ];
    for (const call of calls) expect((await refusalOf(call)).code).toBe("permission_denied");
  });

  it("a send cannot be approved by its own sender", async () => {
    const message = await preparedMessage();
    await fake.submitAdminMessage({ p_message: message.id, p_actor: sender });
    const info = await refusalOf(fake.approveAdminMessage({ p_message: message.id, p_actor: sender, p_kind_confirmed: message.kind }));
    expect(info.reason).toBe("self_approval");
    expect(message.approved_by).toBeNull();
  });

  it("approval is refused without the kind confirmation and when it names the other kind", async () => {
    const message = await preparedMessage();
    await fake.submitAdminMessage({ p_message: message.id, p_actor: sender });
    expect((await refusalOf(fake.approveAdminMessage({ p_message: message.id, p_actor: approver, p_kind_confirmed: "promotion" }))).reason).toBe("kind_not_confirmed");
    expect((await refusalOf(fake.approveAdminMessage({ p_message: message.id, p_actor: approver, p_kind_confirmed: undefined as never }))).reason).toBe("kind_not_confirmed");
  });

  it("the confirmation is stored on the message and in the approved event", async () => {
    const message = await preparedMessage();
    await fake.submitAdminMessage({ p_message: message.id, p_actor: sender });
    await fake.approveAdminMessage({ p_message: message.id, p_actor: approver, p_kind_confirmed: "service_announcement" });
    expect(message).toMatchObject({ status: "approved", kind_confirmed_by_approver: "service_announcement", approved_by_email: "approver@example.test" });
    expect(fake.events.find((e) => e.event === "approved")?.detail).toEqual({ kind_confirmed: "service_announcement" });
  });

  it("a repeat or double start sends nothing extra", async () => {
    const message = await preparedMessage();
    await fake.submitAdminMessage({ p_message: message.id, p_actor: sender });
    await fake.approveAdminMessage({ p_message: message.id, p_actor: approver, p_kind_confirmed: message.kind });
    const [first, second] = await Promise.all([
      fake.startAdminMessageSend({ p_message: message.id, p_actor: sender }),
      fake.startAdminMessageSend({ p_message: message.id, p_actor: sender }),
    ]);
    expect([first, second].filter((v) => v !== null)).toEqual([message.id]);
    expect(fake.events.filter((e) => e.event === "send_started")).toHaveLength(1);
  });

  it("the admin_messaging flag stops a start, and a missing row is off", async () => {
    const message = await preparedMessage({ createdBy: sender, requiresApproval: false });
    fake.setFlag(NOTIFICATION_FLAGS.adminMessaging, false);
    expect(await fake.startAdminMessageSend({ p_message: message.id, p_actor: sender })).toBeNull();
    fake.removeFlag(NOTIFICATION_FLAGS.adminMessaging);
    expect(await fake.startAdminMessageSend({ p_message: message.id, p_actor: sender })).toBeNull();
    expect(message.status).toBe("prepared");
    expect(fake.events.filter((e) => e.event === "flag_stopped")).toHaveLength(2);
  });

  it("the stored recipient count equals the number of recipient rows queued", async () => {
    for (let i = 0; i < 7; i += 1) fake.addPerson({ id: fake.newId() });
    const message = await preparedMessage();
    expect(message.audience_count).toBe(7);
    expect(fake.recipients.filter((r) => r.message_id === message.id)).toHaveLength(7);
  });

  it("an opted-out person gets no push or promotional email flag", async () => {
    const optedIn = fake.newId();
    const optedOut = fake.newId();
    fake.addPerson({ id: optedIn, prefs: { push_enabled: true, push_promotions: true, email_promotions: true } });
    fake.addDevice({ userId: optedIn });
    fake.addPerson({ id: optedOut, prefs: { push_enabled: true, push_promotions: false, email_promotions: false } });
    fake.addDevice({ userId: optedOut });
    const message = await preparedMessage({
      createdBy: sender, kind: "promotion", channels: ["inapp", "push", "email"], consentLine: "You asked for offers",
    });
    const rowFor = (id: string) => fake.recipients.find((r) => r.message_id === message.id && r.user_id === id)!;
    expect(rowFor(optedIn)).toMatchObject({ to_inapp: true, to_push: true, to_email: true });
    expect(rowFor(optedOut)).toMatchObject({ to_inapp: true, to_push: false, to_email: false });
  });

  it("an email recipient inactive for over 30 days gets no email flag", async () => {
    const stale = fake.newId();
    fake.addPerson({ id: stale, lastActiveAt: new Date(fake.now().getTime() - 31 * DAY).toISOString() });
    const message = await preparedMessage({ createdBy: sender, channels: ["email"] });
    expect(fake.recipients.find((r) => r.message_id === message.id && r.user_id === stale)?.to_email).toBe(false);
  });

  it("every segment excludes pending-deletion and QA accounts", async () => {
    const ordinary = fake.newId();
    fake.addPerson({ id: ordinary, country: "Nigeria" });
    fake.addPerson({ id: fake.newId(), deletionRequested: true, country: "Nigeria" });
    fake.addPerson({ id: fake.newId(), isQa: true, country: "Nigeria" });
    const params = { days: 30 as const, since: "2020-01-01", country: "Nigeria" };
    for (const key of ["everyone", "seekers", "inactive_seekers", "signed_up_since", "country"] as const) {
      fake.person(ordinary)!.lastActiveAt = new Date(fake.now().getTime() - 100 * DAY).toISOString();
      const ids = await fake.resolveAdminSegment({ p_actor: sender, p_key: key, p_params: params });
      expect(ids, key).toEqual([ordinary]);
    }
  });

  it("the country segment matches a display name exactly, ignoring case and spaces; null and Other never match", async () => {
    const ng = fake.newId();
    fake.addPerson({ id: ng, country: "  nigeria " });
    fake.addPerson({ id: fake.newId(), country: null });
    fake.addPerson({ id: fake.newId(), country: "Other" });
    fake.addPerson({ id: fake.newId(), country: "Nigerian" });
    expect(await fake.resolveAdminSegment({ p_actor: sender, p_key: "country", p_params: { country: "Nigeria" } })).toEqual([ng]);
    expect(await fake.resolveAdminSegment({ p_actor: sender, p_key: "country", p_params: { country: "Other" } })).toEqual([]);
  });

  it("prepare refuses an audience over 500, and the database ceiling of 5000 holds whatever the caller passes", async () => {
    for (let i = 0; i < 501; i += 1) fake.addPerson({ id: fake.newId() });
    const message = fake.addDraftMessage({ createdBy: sender });
    expect((await refusalOf(fake.prepareAdminMessage({ p_message: message.id, p_actor: sender, p_max_audience: 500 }))).reason).toBe("audience_over_limit");
    expect(fake.recipients).toHaveLength(0);

    const big = new FakeNotificationBackend();
    big.addAdmin(sender, "sender@example.test", ["user_messaging"]);
    for (const key of [NOTIFICATION_FLAGS.master, NOTIFICATION_FLAGS.adminMessaging]) big.setFlag(key, true);
    for (let i = 0; i < 5001; i += 1) big.addPerson({ id: big.newId() });
    const draft = big.addDraftMessage({ createdBy: sender });
    const info = await big.prepareAdminMessage({ p_message: draft.id, p_actor: sender, p_max_audience: 999_999 }).catch((e: NotificationDbError) => e.info);
    expect(info).toMatchObject({ reason: "audience_over_limit" });
  });

  it("a sixth send by one operator, and an eleventh overall, inside 24 hours is refused; the window rolls", async () => {
    const started = (by: string, ago: number) => {
      const m = fake.addDraftMessage({ createdBy: by });
      m.sent_started_at = new Date(fake.now().getTime() - ago).toISOString();
    };
    for (let i = 0; i < 5; i += 1) started(sender, i * HOUR);
    const sixth = fake.addDraftMessage({ createdBy: sender });
    expect((await refusalOf(fake.prepareAdminMessage({ p_message: sixth.id, p_actor: sender, p_max_audience: 500 }))).reason).toBe("operator_daily_limit");

    fake.advance(20 * HOUR); // the oldest sends are now older than 24 hours
    expect((await fake.prepareAdminMessage({ p_message: sixth.id, p_actor: sender, p_max_audience: 500 })) >= 0).toBe(true);

    const other = fake.newId();
    fake.addAdmin(other, "o@example.test", ["user_messaging"]);
    for (let i = 0; i < 10; i += 1) started(other, 1000 * i);
    const next = fake.addDraftMessage({ createdBy: approver });
    expect((await refusalOf(fake.prepareAdminMessage({ p_message: next.id, p_actor: approver, p_max_audience: 500 }))).reason).toBe("overall_daily_limit");
  });

  it("promotions refuse without a consent line, while admin_promotions is off, and the email channel refuses while admin_email is off", async () => {
    const noConsent = fake.addDraftMessage({ createdBy: sender, kind: "promotion", consentLine: "  " });
    expect((await refusalOf(fake.prepareAdminMessage({ p_message: noConsent.id, p_actor: sender, p_max_audience: 500 }))).reason).toBe("consent_required");
    fake.setFlag(NOTIFICATION_FLAGS.adminPromotions, false);
    const flagged = fake.addDraftMessage({ createdBy: sender, kind: "promotion", consentLine: "You asked" });
    expect((await refusalOf(fake.prepareAdminMessage({ p_message: flagged.id, p_actor: sender, p_max_audience: 500 }))).reason).toBe("flag_off");
    fake.setFlag(NOTIFICATION_FLAGS.adminEmail, false);
    const email = fake.addDraftMessage({ createdBy: sender, channels: ["email"] });
    expect((await refusalOf(fake.prepareAdminMessage({ p_message: email.id, p_actor: sender, p_max_audience: 500 }))).reason).toBe("flag_off");
  });

  it("a test send reaches no one and cannot block the real send", async () => {
    const message = await preparedMessage({ createdBy: sender, requiresApproval: false });
    await fake.recordAdminMessageTest({ p_message: message.id, p_actor: sender });
    expect(message.status).toBe("prepared");
    expect(await fake.startAdminMessageSend({ p_message: message.id, p_actor: sender })).toBe(message.id);
  });

  it("a paused message keeps its queued recipients with an empty email outcome, and resume needs the permission and flags", async () => {
    for (let i = 0; i < 3; i += 1) fake.addPerson({ id: fake.newId() });
    const message = await preparedMessage({ createdBy: sender, channels: ["email"], requiresApproval: false });
    await fake.startAdminMessageSend({ p_message: message.id, p_actor: sender });
    await fake.pauseAdminMessageSend({ p_message: message.id, p_reason: "ceiling_month" });
    expect(message.status).toBe("paused_email_ceiling");
    expect(fake.recipients.filter((r) => r.message_id === message.id).every((r) => r.email_outcome === null)).toBe(true);

    const outsider = fake.newId();
    fake.addAdmin(outsider, "x@example.test", []);
    expect((await refusalOf(fake.resumeAdminMessageSend({ p_message: message.id, p_actor: outsider }))).code).toBe("permission_denied");
    fake.setFlag(NOTIFICATION_FLAGS.adminEmail, false);
    expect((await refusalOf(fake.resumeAdminMessageSend({ p_message: message.id, p_actor: sender }))).reason).toBe("flag_off");
    expect(message.status).toBe("paused_email_ceiling"); // never resumes by itself

    fake.setFlag(NOTIFICATION_FLAGS.adminEmail, true);
    await fake.resumeAdminMessageSend({ p_message: message.id, p_actor: sender });
    expect(message.status).toBe("sending");
    expect(fake.events.some((e) => e.event === "resumed")).toBe(true);
  });

  it("the audit is readable only through the permission-checked function", async () => {
    const message = await preparedMessage();
    const rows = await fake.adminMessageAudit({ p_actor: sender, p_message: message.id });
    expect(rows.map((r) => r.event)).toEqual(["created", "prepared"]);
  });

  it("the eligible-recipient filter drops no-profile, pending-deletion, QA, opted-out, unconfirmed and blank-address people", async () => {
    const ok = fake.newId();
    fake.addPerson({ id: ok });
    const bad = [
      fake.newId(), // no profile
    ];
    const ids = [ok, ...bad];
    for (const overrides of [
      { deletionRequested: true }, { isQa: true }, { emailConfirmed: false }, { emailPresent: false }, { prefs: { email_announcements: false } },
    ]) {
      const id = fake.newId();
      fake.addPerson({ id, ...overrides });
      ids.push(id);
    }
    expect(await fake.adminEmailEligibleRecipients({ p_user_ids: ids, p_stream: "announcements" })).toEqual([ok]);
  });
});

describe("the push sender fake", () => {
  const payload = { v: 1 as const, kind: "match_alert" as const, title: "t", body: "b", url: "/jobs", tag: "x", badge: 1 };
  const target = { deviceId: "device-1", endpoint: "https://push.example.invalid/SECRET-ENDPOINT", p256dh: "SECRET-KEY", auth: "SECRET-AUTH" };

  it("records what it sent, by device, and never stores the endpoint or keys", async () => {
    const sender = new FakePushSender();
    expect(await sender.send(target, payload)).toEqual({ outcome: "sent" });
    expect(sender.sent).toEqual([{ deviceId: "device-1", payload }]);
    expect(JSON.stringify(sender)).not.toContain("SECRET");
  });

  it("answers with a scripted definitive or unknown outcome and records nothing for a failure", async () => {
    const sender = new FakePushSender();
    sender.answerDeviceWith("device-1", "gone");
    expect(await sender.send(target, payload)).toEqual({ outcome: "gone" });
    sender.answerWith("unknown");
    expect(await sender.send({ ...target, deviceId: "device-2" }, payload)).toEqual({ outcome: "unknown" });
    expect(sender.sent).toEqual([]);
  });
});
