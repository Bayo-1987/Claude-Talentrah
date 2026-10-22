import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_MESSAGE_EVENT_KINDS,
  NOTIFICATION_FLAGS,
  type NotificationChannel,
  type NotificationKind,
} from "@/lib/notifications/contract";
import { CLAIM_REFUSALS, NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * The Reviewer's rulings of 22 Oct 2026 that apply to the contract, each driven
 * through the fake the way a builder would meet it:
 *   R-D3   the cap of 3 distinct events is the per-user push budget only
 *   R-D2/15 business refusals are DATA (a row), callers' mistakes RAISE
 *   R-D9   the segment function needs a non-null actor
 *   R-D10  the 'rejected' event kind exists (no writer is required)
 */
const HOUR = 3_600_000;
let fake: FakeNotificationBackend;
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z")); // 13:00 in Lagos
});

const claim = (user: string, kind: NotificationKind, subject: string, channel: NotificationChannel, device?: string) =>
  fake.claimNotification({ p_user: user, p_kind: kind, p_subject: subject, p_channel: channel, p_device: device ?? null });
const errorInfo = async (promise: Promise<unknown>) => ((await promise.catch((e: unknown) => e)) as NotificationDbError).info;

function person() {
  const user = fake.newId();
  fake.addPerson({ id: user });
  return { user, device: fake.addDevice({ userId: user }).id };
}

describe("R-D2/D15: the six refusal codes are data and never raise", () => {
  /** One scenario per code, each built to hit exactly that code. */
  const scenarios: Record<(typeof CLAIM_REFUSALS)[number], () => Promise<unknown>> = {
    device_unavailable: () => {
      const { user } = person();
      return claim(user, "match_alert", fake.newId(), "push", fake.newId());
    },
    quiet_hours: () => {
      fake.setNow(new Date("2026-10-26T22:00:00Z")); // 23:00 in Lagos
      const { user, device } = person();
      return claim(user, "match_alert", fake.newId(), "push", device);
    },
    budget_cap: async () => {
      const { user, device } = person();
      for (let i = 0; i < 3; i += 1) await claim(user, "match_alert", fake.newId(), "push", device);
      return claim(user, "match_alert", fake.newId(), "push", device);
    },
    cap_24h: async () => {
      fake.putSetting("mass_email_cap_24h", 1, null);
      await claim(fake.newId(), "admin_message", fake.newId(), "email");
      return claim(fake.newId(), "admin_message", fake.newId(), "email");
    },
    ceiling_month: async () => {
      fake.putSetting("mass_email_ceiling_month", 1, null);
      await claim(fake.newId(), "admin_message", fake.newId(), "email");
      return claim(fake.newId(), "admin_message", fake.newId(), "email");
    },
    already_claimed: async () => {
      const user = fake.newId();
      const subject = fake.newId();
      await claim(user, "match_alert", subject, "inapp");
      return claim(user, "match_alert", subject, "inapp");
    },
  };

  for (const code of CLAIM_REFUSALS) {
    it(`${code} comes back as a row: id null, refused set, nothing raised`, async () => {
      const result = (await scenarios[code]()) as { id: string | null; refused: string | null };
      expect(result).toEqual({ id: null, refused: code });
    });
  }

  it("the scenarios cover every code the contract lists", () => {
    expect(Object.keys(scenarios).sort()).toEqual([...CLAIM_REFUSALS].sort());
  });

  it("a successful claim is { id set, refused null }; a refusal is { id null, refused set }; never both, never neither", async () => {
    const outcomes: { id: string | null; refused: string | null }[] = [];
    for (const code of CLAIM_REFUSALS) outcomes.push((await scenarios[code]()) as (typeof outcomes)[number]);
    fake.setNow(new Date("2026-10-26T12:00:00Z")); // the quiet-hours scenario moved the clock
    const { user, device } = person();
    outcomes.push(await claim(user, "match_alert", fake.newId(), "push", device));
    outcomes.push(await claim(user, "match_alert", fake.newId(), "inapp"));
    expect(outcomes).toHaveLength(8);
    for (const outcome of outcomes) {
      expect(outcome.id === null).not.toBe(outcome.refused === null);
      if (outcome.refused !== null) expect(CLAIM_REFUSALS as readonly string[]).toContain(outcome.refused);
      if (outcome.id !== null) expect(outcome.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(outcomes.filter((o) => o.id !== null)).toHaveLength(2);
  });

  it("only caller errors raise: an unknown kind (22023), an unknown id on release (P0001, unknown_id)", async () => {
    const { user } = person();
    expect(await errorInfo(claim(user, "nope" as never, fake.newId(), "inapp"))).toMatchObject({ code: "invalid_parameter", sqlstate: "22023" });
    expect(await errorInfo(fake.releaseNotification({ p_id: fake.newId(), p_reason: "gone" }))).toMatchObject({
      code: "refused", sqlstate: "P0001", reason: "unknown_id",
    });
  });
});

describe("R-D3: budgets", () => {
  it("the per-user cap is 3 distinct events: a second device for a counted event is allowed at the cap, a fourth distinct event is budget_cap", async () => {
    const { user, device } = person();
    const second = fake.addDevice({ userId: user }).id;
    const events = [fake.newId(), fake.newId(), fake.newId()];
    for (const event of events) expect((await claim(user, "match_alert", event, "push", device)).id).not.toBeNull();
    expect((await claim(user, "match_alert", events[0], "push", second)).id).not.toBeNull();
    expect(await claim(user, "match_alert", fake.newId(), "push", device)).toEqual({ id: null, refused: "budget_cap" });
  });

  it("the admin budget cap is 1; an admin message does not consume the user budget, and the reverse", async () => {
    const adminFirst = person();
    expect((await claim(adminFirst.user, "admin_message", fake.newId(), "push", adminFirst.device)).id).not.toBeNull();
    expect((await claim(adminFirst.user, "admin_message", fake.newId(), "push", adminFirst.device)).refused).toBe("budget_cap");
    for (let i = 0; i < 3; i += 1) {
      expect((await claim(adminFirst.user, "new_applicant", fake.newId(), "push", adminFirst.device)).id).not.toBeNull();
    }
    expect((await claim(adminFirst.user, "new_applicant", fake.newId(), "push", adminFirst.device)).refused).toBe("budget_cap");

    const usersFirst = person();
    for (let i = 0; i < 3; i += 1) await claim(usersFirst.user, "match_alert", fake.newId(), "push", usersFirst.device);
    expect((await claim(usersFirst.user, "admin_message", fake.newId(), "push", usersFirst.device)).id).not.toBeNull();
  });
});

describe("R-D9: the segment function needs an actor", () => {
  it("a null or missing actor raises 22023, before any permission check", async () => {
    for (const p_actor of [null, undefined]) {
      const info = await errorInfo(fake.resolveAdminSegment({ p_key: "everyone", p_params: {}, p_actor } as never));
      expect(info).toMatchObject({ code: "invalid_parameter", sqlstate: "22023" });
    }
  });
  it("an actor without the permission is still 42501", async () => {
    const stranger = fake.newId();
    fake.addAdmin(stranger, "s@example.test", []);
    expect(await errorInfo(fake.resolveAdminSegment({ p_key: "everyone", p_params: {}, p_actor: stranger }))).toMatchObject({
      code: "permission_denied", sqlstate: "42501",
    });
  });
});

describe("R-D10: the rejected event kind", () => {
  it("exists in the closed list of audit event kinds (nothing is required to write it)", () => {
    expect(ADMIN_MESSAGE_EVENT_KINDS as readonly string[]).toContain("rejected");
  });
});

describe("M8: no row the fake returns or stores carries an address-like key beyond the allowed names", () => {
  const ALLOWED = new Set(["created_by_email", "approved_by_email", "actor_email", "updated_by_email", "to_email", "email_outcome"]);
  const NAME_RULE = /e-?mail|addr|recip|rcpt/i;

  const keysDeep = (value: unknown, found = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((item) => keysDeep(item, found));
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        found.add(key);
        keysDeep(inner, found);
      }
    }
    return found;
  };

  it("a full flow through the fake", async () => {
    const operator = fake.newId();
    const approver = fake.newId();
    const ops = fake.newId();
    fake.addAdmin(operator, "operator@example.test", ["user_messaging"]);
    fake.addAdmin(approver, "approver@example.test", ["user_messaging"]);
    fake.addAdmin(ops, "ops@example.test", ["operators", "user_messaging"]);
    for (const key of Object.values(NOTIFICATION_FLAGS)) fake.setFlag(key, true);
    const people = [fake.newId(), fake.newId()];
    for (const id of people) {
      fake.addPerson({ id, unsubscribeToken: `t-${id}`, prefs: { push_enabled: true, email_promotions: true } });
      await fake.forCaller(id).registerPushSubscription({
        p_endpoint: `https://push.example.invalid/${id}`, p_p256dh: "k", p_auth: "a", p_ua: "Chrome",
      });
    }
    const returned: unknown[] = [];
    returned.push(await claim(people[0], "match_alert", fake.newId(), "push", fake.devices[0].id));
    returned.push(await claim(people[0], "admin_message", fake.newId(), "email"));
    returned.push(await claim(people[1], "new_applicant", fake.newId(), "inapp"));
    fake.advance(48 * HOUR);
    returned.push(await fake.staleNotificationClaims({ p_channel: "email", p_older_than: "1 hour" }));
    returned.push(await fake.resolveAdminSegment({ p_key: "everyone", p_params: {}, p_actor: operator }));

    const message = fake.addDraftMessage({ createdBy: operator, channels: ["inapp", "push", "email"] });
    returned.push(await fake.prepareAdminMessage({ p_message: message.id, p_actor: operator, p_max_audience: 500 }));
    await fake.submitAdminMessage({ p_message: message.id, p_actor: operator });
    await fake.approveAdminMessage({ p_message: message.id, p_actor: approver, p_kind_confirmed: message.kind });
    returned.push(await fake.startAdminMessageSend({ p_message: message.id, p_actor: operator }));
    await fake.recordAdminMessageTest({ p_message: message.id, p_actor: operator });
    await fake.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 60, p_actor: ops });
    returned.push(await fake.adminMessageAudit({ p_actor: operator }));
    returned.push(await fake.adminEmailEligibleRecipients({ p_user_ids: people, p_stream: "promotions" }));
    returned.push(await fake.emailUnsubscribeStream({ p_token: `t-${people[0]}`, p_stream: "promotions" }));
    returned.push(fake.listDevices(people[0]));
    // Everything the fake stores is a row it can hand back.
    returned.push(fake.deliveries, fake.devices, fake.messages, fake.recipients, fake.events, fake.settings, fake.settingChanges);

    const keys = [...keysDeep(returned)];
    expect(keys.length).toBeGreaterThan(40); // the flow really produced rows
    const offenders = keys.filter((key) => NAME_RULE.test(key) && !ALLOWED.has(key));
    expect(offenders, "keys outside the allowed names").toEqual([]);
    // The allowed names do appear, so the check is not vacuous.
    for (const name of ["created_by_email", "actor_email", "to_email", "email_outcome", "updated_by_email"]) {
      expect(keys, name).toContain(name);
    }
  });
});
