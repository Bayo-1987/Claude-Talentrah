import { describe, expect, it, vi } from "vitest";
import type { PushSubscriptionClientRow, RegisterPushSubscriptionArgs } from "@/lib/notifications/contract";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { notificationErrorFrom } from "@/lib/notifications/contract-db";
import { MAX_BODY_BYTES, handleDeviceRemove, handleDevices, handleSubscribe, type PushRouteDeps, type PushSession } from "@/lib/notifications/push/routes";

const SITE = "https://site.example.test";
const DEVICE_ID = "00000000-0000-4000-8000-0000000000d1";
const ROW: PushSubscriptionClientRow = { id: DEVICE_ID, ua_short: "Android Chrome", created_at: "2026-10-28T10:00:00Z", last_seen_at: "2026-10-28T10:00:00Z", revoked_at: null };
const GOOD_BODY = { endpoint: "https://push.example.test/send/abc", p256dh: "p256dh-value", auth: "auth-value", timezone: "Africa/Lagos" };

function harness(over: { signedIn?: boolean; flags?: Record<string, boolean>; env?: { PWA_KILL?: string }; session?: Partial<PushSession> } = {}) {
  const calls = { register: [] as RegisterPushSubscriptionArgs[], remove: [] as string[], list: 0 };
  const session: PushSession = {
    register: async (args) => {
      calls.register.push(args);
      return DEVICE_ID;
    },
    listDevices: async () => {
      calls.list += 1;
      return [ROW];
    },
    removeDevice: async (id) => {
      calls.remove.push(id);
    },
    ...over.session,
  };
  const flags = over.flags ?? { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: true };
  const deps: PushRouteDeps = {
    env: over.env ?? {},
    flagOn: async (key) => flags[key] === true,
    session: async () => (over.signedIn === false ? null : session),
  };
  return { deps, calls };
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}${path}`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path: string) => new Request(`${SITE}${path}`, { method: "GET" });

describe("POST /api/push/subscribe", () => {
  it("registers through the session and answers 200 { id }", async () => {
    const h = harness();
    const response = await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: DEVICE_ID });
    expect(h.calls.register).toHaveLength(1);
    expect(h.calls.register[0]).toMatchObject({ p_endpoint: GOOD_BODY.endpoint, p_p256dh: GOOD_BODY.p256dh, p_auth: GOOD_BODY.auth, p_timezone: "Africa/Lagos" });
    expect(h.calls.register[0].p_ua.length).toBeLessThanOrEqual(40);
    expect(h.calls.register[0].p_ua).not.toContain("Mozilla");
  });
  it("posting again is the reconcile: it registers again and answers the same shape", async () => {
    const h = harness();
    for (let i = 0; i < 2; i += 1) expect(await (await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps)).json()).toEqual({ id: DEVICE_ID });
    expect(h.calls.register).toHaveLength(2);
  });
  it("a request whose Origin does not match the site is 403 refused and writes nothing", async () => {
    for (const origin of ["https://evil.example", "null", "https://site.example.test.evil.example", "http://site.example.test:3000"]) {
      const h = harness();
      const response = await handleSubscribe(post("/api/push/subscribe", GOOD_BODY, { origin }), h.deps);
      expect([response.status, await response.json()]).toEqual([403, { error: "refused" }]);
      expect(h.calls.register).toHaveLength(0);
    }
  });
  it("a request with no Origin and no Referer is 403 refused", async () => {
    const h = harness();
    const request = new Request(`${SITE}/api/push/subscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(GOOD_BODY) });
    expect((await handleSubscribe(request, h.deps)).status).toBe(403);
    expect(h.calls.register).toHaveLength(0);
  });
  it("signed out is 401 permission_denied", async () => {
    const h = harness({ signedIn: false });
    const response = await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps);
    expect([response.status, await response.json()]).toEqual([401, { error: "permission_denied" }]);
  });
  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["a missing endpoint", JSON.stringify({ ...GOOD_BODY, endpoint: undefined })],
    ["an empty key", JSON.stringify({ ...GOOD_BODY, p256dh: "" })],
    ["a number for auth", JSON.stringify({ ...GOOD_BODY, auth: 7 })],
    ["a timezone that is not text", JSON.stringify({ ...GOOD_BODY, timezone: 5 })],
  ])("%s is 400 invalid_parameter and writes nothing", async (_name, body) => {
    const h = harness();
    const response = await handleSubscribe(post("/api/push/subscribe", body), h.deps);
    expect([response.status, await response.json()]).toEqual([400, { error: "invalid_parameter" }]);
    expect(h.calls.register).toHaveLength(0);
  });
  it("a body over 4 KB is rejected with 400 before anything is written", async () => {
    expect(MAX_BODY_BYTES).toBe(4096);
    const h = harness();
    const big = JSON.stringify({ ...GOOD_BODY, endpoint: `https://push.example.test/${"a".repeat(5000)}` });
    const response = await handleSubscribe(post("/api/push/subscribe", big), h.deps);
    expect([response.status, await response.json()]).toEqual([400, { error: "invalid_parameter" }]);
    expect(h.calls.register).toHaveLength(0);
  });
  it("a database refusal (host not allowed, device limit, value too long) is 422 refused with no reason in the answer", async () => {
    for (const hint of ["host_not_allowed", "device_limit", "value_too_long"]) {
      const h = harness({ session: { register: async () => Promise.reject(notificationErrorFrom({ code: "P0001", hint }, { rpc: "registerPushSubscription" })) } });
      const response = await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps);
      const text = await response.clone().text();
      expect([response.status, JSON.parse(text)]).toEqual([422, { error: "refused" }]);
      for (const leak of [hint, "register", "P0001"]) expect(text).not.toContain(leak);
    }
  });
  it("a database 'invalid parameter' is 400 and a database 'permission denied' is 401", async () => {
    const bad = harness({ session: { register: async () => Promise.reject(notificationErrorFrom({ code: "22023" }, { rpc: "registerPushSubscription" })) } });
    expect((await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), bad.deps)).status).toBe(400);
    const denied = harness({ session: { register: async () => Promise.reject(notificationErrorFrom({ code: "42501" }, { rpc: "registerPushSubscription" })) } });
    expect((await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), denied.deps)).status).toBe(401);
  });
  it("anything unexpected is 500 unknown and the thrown text never reaches the answer", async () => {
    const h = harness({ session: { register: async () => Promise.reject(new Error('relation "secret_table" does not exist at https://push.example.test/send/abc')) } });
    const response = await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps);
    const text = await response.text();
    expect([response.status, JSON.parse(text)]).toEqual([500, { error: "unknown" }]);
    expect(text).not.toContain("secret_table");
    expect(text).not.toContain("push.example.test");
  });
});

describe("the kill switch and the flags on the three routes", () => {
  const OFF: Array<[string, { flags?: Record<string, boolean>; env?: { PWA_KILL?: string } }]> = [
    ["every flag off", { flags: {} }],
    ["notifications_master off", { flags: { [NOTIFICATION_FLAGS.master]: false, [NOTIFICATION_FLAGS.pushSender]: true } }],
    ["push_sender off", { flags: { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: false } }],
    ["PWA_KILL=1", { env: { PWA_KILL: "1" } }],
  ];
  it.each(OFF)("with %s subscribe answers 403 refused and writes nothing", async (_name, over) => {
    const h = harness(over);
    const response = await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps);
    expect([response.status, await response.json()]).toEqual([403, { error: "refused" }]);
    expect(h.calls.register).toHaveLength(0);
  });
  it.each(OFF)("with %s devices and remove stay open", async (_name, over) => {
    const h = harness(over);
    const listed = await handleDevices(get("/api/push/devices"), h.deps);
    expect([listed.status, await listed.json()]).toEqual([200, { devices: [ROW] }]);
    const removed = await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }), h.deps);
    expect([removed.status, await removed.json()]).toEqual([200, {}]);
    expect(h.calls.remove).toEqual([DEVICE_ID]);
  });
  it("an unreadable flag means off for subscribe", async () => {
    const h = harness();
    h.deps.flagOn = async () => {
      throw new Error("flag store unreachable");
    };
    expect((await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), h.deps)).status).toBe(403);
    expect(h.calls.register).toHaveLength(0);
  });
});

describe("GET /api/push/devices", () => {
  it("answers { devices } with only the five client columns, even if the session returned more", async () => {
    const leaky = { ...ROW, endpoint: "https://push.example.test/send/abc", p256dh: "k", auth: "a", user_id: "u", timezone: "Africa/Lagos" } as PushSubscriptionClientRow;
    const h = harness({ session: { listDevices: async () => [leaky] } });
    const response = await handleDevices(get("/api/push/devices"), h.deps);
    const text = await response.text();
    expect(Object.keys(JSON.parse(text).devices[0]).sort()).toEqual(["created_at", "id", "last_seen_at", "revoked_at", "ua_short"]);
    for (const leak of ["push.example.test", "p256dh", "user_id", "timezone"]) expect(text).not.toContain(leak);
  });
  it("signed out is 401; a failing read is 500 unknown with no database text", async () => {
    const out = harness({ signedIn: false });
    const denied = await handleDevices(get("/api/push/devices"), out.deps);
    expect([denied.status, await denied.json()]).toEqual([401, { error: "permission_denied" }]);
    const broken = harness({ session: { listDevices: async () => Promise.reject(new Error("permission denied for table secret_table")) } });
    const response = await handleDevices(get("/api/push/devices"), broken.deps);
    const text = await response.text();
    expect([response.status, JSON.parse(text)]).toEqual([500, { error: "unknown" }]);
    expect(text).not.toContain("secret_table");
  });
});

describe("POST /api/push/devices/remove", () => {
  it("deletes by id through the session and answers 200 {}", async () => {
    const h = harness();
    const response = await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }), h.deps);
    expect([response.status, await response.json()]).toEqual([200, {}]);
    expect(h.calls.remove).toEqual([DEVICE_ID]);
  });
  it("a request whose Origin does not match the site is 403 refused and deletes nothing", async () => {
    const h = harness();
    const response = await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }, { origin: "https://evil.example" }), h.deps);
    expect([response.status, await response.json()]).toEqual([403, { error: "refused" }]);
    expect(h.calls.remove).toEqual([]);
  });
  it("signed out is 401; a bad id or body is 400; an oversize body is 400", async () => {
    const out = harness({ signedIn: false });
    expect((await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }), out.deps)).status).toBe(401);
    for (const body of [{ id: "not-a-uuid" }, { id: 5 }, {}, "[]", "{x", JSON.stringify({ id: DEVICE_ID, pad: "a".repeat(5000) })]) {
      const h = harness();
      const response = await handleDeviceRemove(post("/api/push/devices/remove", body), h.deps);
      expect([response.status, await response.json()]).toEqual([400, { error: "invalid_parameter" }]);
      expect(h.calls.remove).toEqual([]);
    }
  });
  it("a failing delete is 500 unknown with no database text", async () => {
    const h = harness({ session: { removeDevice: async () => Promise.reject(notificationErrorFrom({ code: "XX000" }, { table: "pushSubscriptions" })) } });
    const response = await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }), h.deps);
    const text = await response.text();
    expect([response.status, JSON.parse(text)]).toEqual([500, { error: "unknown" }]);
    expect(text).not.toContain("XX000");
  });
});

describe("every response", () => {
  it("carries Cache-Control: no-store, whatever the status, and never a database message or a reason string", async () => {
    const reasons = ["host_not_allowed", "device_limit", "value_too_long", "flag_off", "not_found"];
    const responses: Response[] = [];
    const ok = harness();
    responses.push(await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), ok.deps));
    responses.push(await handleSubscribe(post("/api/push/subscribe", GOOD_BODY, { origin: "https://evil.example" }), ok.deps));
    responses.push(await handleSubscribe(post("/api/push/subscribe", "{"), ok.deps));
    responses.push(await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), harness({ signedIn: false }).deps));
    responses.push(await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), harness({ flags: {} }).deps));
    const refusing = harness({ session: { register: async () => Promise.reject(notificationErrorFrom({ code: "P0001", hint: "device_limit" }, { rpc: "registerPushSubscription" })) } });
    responses.push(await handleSubscribe(post("/api/push/subscribe", GOOD_BODY), refusing.deps));
    responses.push(await handleDevices(get("/api/push/devices"), ok.deps));
    responses.push(await handleDevices(get("/api/push/devices"), harness({ signedIn: false }).deps));
    responses.push(await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }), ok.deps));
    responses.push(await handleDeviceRemove(post("/api/push/devices/remove", { id: DEVICE_ID }, { origin: "https://evil.example" }), ok.deps));
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      for (const reason of reasons) expect(text).not.toContain(reason);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (response.status >= 400) expect(Object.keys(parsed)).toEqual(["error"]);
    }
    vi.restoreAllMocks();
  });
});
