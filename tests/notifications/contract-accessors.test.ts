import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import type { RpcKey } from "@/lib/notifications/contract";
import * as db from "@/lib/notifications/contract-db";
import { NOTIFICATION_RPCS, NOTIFICATION_TABLES, NotificationDbError } from "@/lib/notifications/contract-db";

/**
 * The accessor module against a REAL supabase-js client whose network is a
 * stub. That exercises the exact request the client builds (path and body keys)
 * without a cast in the test and without a database.
 */
type Call = { url: string; method: string; body: unknown };

function clientAnswering(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const text = typeof init?.body === "string" ? init.body : null;
    const call: Call = { url, method: init?.method ?? "GET", body: text ? JSON.parse(text) : null };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>("https://contract-test.invalid", "contract-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchStub },
  });
  return { client, calls };
}

const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";

/** One entry per function: how to call it and what a typical database answer looks like. */
const CASES: Record<RpcKey, { call: (c: db.NotificationClient) => Promise<unknown>; args: Record<string, unknown>; answer: unknown }> = {
  claimNotification: {
    args: { p_user: ID, p_kind: "match_alert", p_subject: ID, p_channel: "inapp" },
    call: (c) => db.claimNotification(c, { p_user: ID, p_kind: "match_alert", p_subject: ID, p_channel: "inapp" }),
    answer: [{ id: ID, refused: null }],
  },
  releaseNotification: {
    args: { p_id: ID, p_reason: "gone" },
    call: (c) => db.releaseNotification(c, { p_id: ID, p_reason: "gone" }),
    answer: null,
  },
  markNotificationSent: { args: { p_id: ID }, call: (c) => db.markNotificationSent(c, { p_id: ID }), answer: null },
  staleNotificationClaims: {
    args: { p_channel: "email", p_older_than: "1 hour" },
    call: (c) => db.staleNotificationClaims(c, { p_channel: "email", p_older_than: "1 hour" }),
    answer: [],
  },
  resolveStaleClaim: {
    args: { p_id: ID, p_actor: ACTOR, p_resolution: "mark_sent" },
    call: (c) => db.resolveStaleClaim(c, { p_id: ID, p_actor: ACTOR, p_resolution: "mark_sent" }),
    answer: null,
  },
  unreadNotificationCount: { args: { p_user: ID }, call: (c) => db.unreadNotificationCount(c, { p_user: ID }), answer: 4 },
  pruneNotificationDeliveries: {
    args: { p_older_than_days: 30 },
    call: (c) => db.pruneNotificationDeliveries(c, { p_older_than_days: 30 }),
    answer: 12,
  },
  registerPushSubscription: {
    args: { p_endpoint: "https://push.example.invalid/x", p_p256dh: "k", p_auth: "a", p_ua: "Chrome" },
    call: (c) => db.registerPushSubscription(c, { p_endpoint: "https://push.example.invalid/x", p_p256dh: "k", p_auth: "a", p_ua: "Chrome" }),
    answer: ID,
  },
  emailUnsubscribeStream: {
    args: { p_token: "t", p_stream: "promotions" },
    call: (c) => db.emailUnsubscribeStream(c, { p_token: "t", p_stream: "promotions" }),
    answer: [{ matched: true }],
  },
  resolveAdminSegment: {
    args: { p_actor: ACTOR, p_key: "everyone", p_params: {} },
    call: (c) => db.resolveAdminSegment(c, { p_actor: ACTOR, p_key: "everyone", p_params: {} }),
    answer: [ID],
  },
  prepareAdminMessage: {
    args: { p_message: ID, p_actor: ACTOR, p_max_audience: 500 },
    call: (c) => db.prepareAdminMessage(c, { p_message: ID, p_actor: ACTOR, p_max_audience: 500 }),
    answer: 3,
  },
  submitAdminMessage: { args: { p_message: ID, p_actor: ACTOR }, call: (c) => db.submitAdminMessage(c, { p_message: ID, p_actor: ACTOR }), answer: null },
  approveAdminMessage: {
    args: { p_message: ID, p_actor: ACTOR, p_kind_confirmed: "promotion" },
    call: (c) => db.approveAdminMessage(c, { p_message: ID, p_actor: ACTOR, p_kind_confirmed: "promotion" }),
    answer: null,
  },
  cancelAdminMessage: { args: { p_message: ID, p_actor: ACTOR }, call: (c) => db.cancelAdminMessage(c, { p_message: ID, p_actor: ACTOR }), answer: null },
  startAdminMessageSend: {
    args: { p_message: ID, p_actor: ACTOR },
    call: (c) => db.startAdminMessageSend(c, { p_message: ID, p_actor: ACTOR }),
    answer: ID,
  },
  adminMessageAudit: { args: { p_actor: ACTOR }, call: (c) => db.adminMessageAudit(c, { p_actor: ACTOR }), answer: [] },
  recordAdminMessageTest: {
    args: { p_message: ID, p_actor: ACTOR },
    call: (c) => db.recordAdminMessageTest(c, { p_message: ID, p_actor: ACTOR }),
    answer: null,
  },
  createAdminMessage: {
    args: { p_actor: ACTOR, p_kind: "service_announcement", p_title: "t", p_body: "b", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null },
    call: (c) => db.createAdminMessage(c, { p_actor: ACTOR, p_kind: "service_announcement", p_title: "t", p_body: "b", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null }),
    answer: ID,
  },
  recordAdminMessageProgress: {
    args: { p_message: ID, p_sent: 1, p_failed: 0, p_skipped: 0 },
    call: (c) => db.recordAdminMessageProgress(c, { p_message: ID, p_sent: 1, p_failed: 0, p_skipped: 0 }),
    answer: null,
  },
  finishAdminMessageSend: {
    args: { p_message: ID },
    call: (c) => db.finishAdminMessageSend(c, { p_message: ID }),
    answer: null,
  },
  setNotificationSetting: {
    args: { p_key: "mass_email_cap_24h", p_value: 60, p_actor: ACTOR },
    call: (c) => db.setNotificationSetting(c, { p_key: "mass_email_cap_24h", p_value: 60, p_actor: ACTOR }),
    answer: null,
  },
  pauseAdminMessageSend: {
    args: { p_message: ID, p_reason: "cap_24h" },
    call: (c) => db.pauseAdminMessageSend(c, { p_message: ID, p_reason: "cap_24h" }),
    answer: null,
  },
  resumeAdminMessageSend: {
    args: { p_message: ID, p_actor: ACTOR },
    call: (c) => db.resumeAdminMessageSend(c, { p_message: ID, p_actor: ACTOR }),
    answer: null,
  },
  adminEmailEligibleRecipients: {
    args: { p_user_ids: [ID], p_stream: "announcements" },
    call: (c) => db.adminEmailEligibleRecipients(c, { p_user_ids: [ID], p_stream: "announcements" }),
    answer: [ID],
  },
};

describe("each accessor posts to its own function with the database argument names", () => {
  for (const key of Object.keys(NOTIFICATION_RPCS) as RpcKey[]) {
    it(key, async () => {
      const entry = CASES[key];
      const { client, calls } = clientAnswering(() => ({ status: entry.answer === null ? 204 : 200, body: entry.answer }));
      await entry.call(client);
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0].url).pathname).toBe(`/rest/v1/rpc/${NOTIFICATION_RPCS[key]}`);
      expect(calls[0].method).toBe("POST");
      expect(calls[0].body).toEqual(entry.args);
    });
  }

  it("the table of cases covers every function key (no accessor is left untested)", () => {
    expect(Object.keys(CASES).sort()).toEqual((Object.keys(NOTIFICATION_RPCS) as RpcKey[]).sort());
  });
});

describe("each table accessor reaches its own table", () => {
  const accessors = {
    deliveries: db.deliveriesTable,
    pushSubscriptions: db.pushSubscriptionsTable,
    adminMessages: db.adminMessagesTable,
    adminMessageRecipients: db.adminMessageRecipientsTable,
    adminMessageEvents: db.adminMessageEventsTable,
    settings: db.notificationSettingsTable,
    settingChanges: db.notificationSettingChangesTable,
  } as const;

  it("covers every table key", () => {
    expect(Object.keys(accessors).sort()).toEqual(Object.keys(NOTIFICATION_TABLES).sort());
  });

  for (const key of Object.keys(accessors) as (keyof typeof accessors)[]) {
    it(key, async () => {
      const { client, calls } = clientAnswering(() => ({ status: 200, body: [] }));
      await accessors[key](client).select("*");
      expect(new URL(calls[0].url).pathname).toBe(`/rest/v1/${NOTIFICATION_TABLES[key]}`);
    });
  }
});

describe("normalising what the database returns", () => {
  const answer = (body: unknown, status = 200) => clientAnswering(() => ({ status, body }));
  const claim = { p_user: ID, p_kind: "admin_message", p_subject: ID, p_channel: "email" } as const;

  it("a claim row has exactly one non-null value; anything else is a broken contract and raises", async () => {
    expect(await db.claimNotification(answer([{ id: ID, refused: null }]).client, claim)).toEqual({ id: ID, refused: null });
    expect(await db.claimNotification(answer({ id: null, refused: "already_claimed" }).client, claim)).toEqual({
      id: null,
      refused: "already_claimed",
    });
    for (const [body, status] of [[null, 204], [[], 200], [[{ id: null, refused: null }], 200], [[{ id: ID, refused: "cap_24h" }], 200]] as const) {
      const error = (await db.claimNotification(answer(body, status).client, claim).catch((e: unknown) => e)) as NotificationDbError;
      expect(error).toBeInstanceOf(NotificationDbError);
      expect(error.info.code).toBe("unknown");
    }
  });

  it("a claim reports which limit refused, and a value outside the closed list raises", async () => {
    expect(await db.claimNotification(answer([{ id: null, refused: "ceiling_month" }]).client, claim)).toEqual({
      id: null,
      refused: "ceiling_month",
    });
    const error = (await db.claimNotification(answer([{ id: null, refused: "something_else" }]).client, claim).catch((e: unknown) => e)) as NotificationDbError;
    expect(error.info.code).toBe("unknown");
  });

  it("a repeat start returns null; a first start returns the message id", async () => {
    const args = { p_message: ID, p_actor: ACTOR };
    expect(await db.startAdminMessageSend(answer(null, 204).client, args)).toBeNull();
    expect(await db.startAdminMessageSend(answer([{ id: ID }]).client, args)).toBe(ID);
  });

  it("an unsubscribe for an unknown token reports matched=false without an error", async () => {
    const args = { p_token: "nope", p_stream: "announcements" } as const;
    expect(await db.emailUnsubscribeStream(answer(null, 204).client, args)).toEqual({ matched: false });
  });

  it("id lists accept bare ids and rows", async () => {
    const args = { p_actor: ACTOR, p_key: "everyone", p_params: {} } as const;
    expect(await db.resolveAdminSegment(answer([ID, { user_id: ACTOR }]).client, args)).toEqual([ID, ACTOR]);
  });
});

describe("errors never carry database text", () => {
  const echoed = "https://push.example.invalid/DO-NOT-LEAK-THIS-ENDPOINT";
  const register = (c: db.NotificationClient) =>
    db.registerPushSubscription(c, { p_endpoint: echoed, p_p256dh: "k", p_auth: "a", p_ua: "Chrome" });
  const failing = (code: string, hint: string | null) =>
    clientAnswering(() => ({
      status: 400,
      body: { code, message: `duplicate key value (endpoint)=(${echoed})`, details: `Key (endpoint)=(${echoed})`, hint },
    }));

  it("a time zone refusal (22023) becomes invalid_parameter and the echoed value is gone", async () => {
    const error = await register(failing("22023", null).client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotificationDbError);
    expect((error as NotificationDbError).info).toMatchObject({ code: "invalid_parameter", sqlstate: "22023", reason: null });
    expect(String((error as Error).message)).not.toContain("DO-NOT-LEAK");
    expect(JSON.stringify((error as NotificationDbError).info)).not.toContain("DO-NOT-LEAK");
  });

  it("a permission failure (42501) becomes permission_denied", async () => {
    const error = (await register(failing("42501", null).client).catch((e: unknown) => e)) as NotificationDbError;
    expect(error.info.code).toBe("permission_denied");
  });

  it("a raised refusal carries its reason only when the hint is in the closed list", async () => {
    const known = (await register(failing("P0001", "device_limit").client).catch((e: unknown) => e)) as NotificationDbError;
    expect(known.info).toMatchObject({ code: "refused", reason: "device_limit" });
    const unknown = (await register(failing("P0001", "free text from the database").client).catch((e: unknown) => e)) as NotificationDbError;
    expect(unknown.info).toMatchObject({ code: "refused", reason: null });
    expect(unknown.message).not.toContain("free text");
  });

  it("an unrecognised SQLSTATE is unknown", async () => {
    const error = (await register(failing("23505", null).client).catch((e: unknown) => e)) as NotificationDbError;
    expect(error.info).toMatchObject({ code: "unknown", sqlstate: "23505" });
  });

  it("the error names the function it came from, using the constant", async () => {
    const error = (await register(failing("42501", null).client).catch((e: unknown) => e)) as NotificationDbError;
    expect(error.info.rpc).toBe(NOTIFICATION_RPCS.registerPushSubscription);
    expect(error.message).toContain(NOTIFICATION_RPCS.registerPushSubscription);
  });
});
