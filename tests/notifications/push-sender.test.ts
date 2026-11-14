import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "@/lib/notifications/contract";
import { PUSH_TTL_SECONDS, createPushSender } from "@/lib/notifications/push/sender";
import { MAX_WIRE_BYTES, WIRE_PAYLOAD_KEYS, buildPushPayload, toWireJson } from "@/lib/notifications/push/payload";
import { makeTarget, recordingLog, recordingSleep, scriptedTransport } from "./push-support";

const payload = (over: Partial<PushPayload> = {}): PushPayload => ({ ...buildPushPayload("new_applicant", { url: "/employer/jobs", badge: 2 }), ...over });
const sender = (script: Parameters<typeof scriptedTransport>[0]) => {
  const t = scriptedTransport(script);
  const s = recordingSleep();
  const l = recordingLog();
  return { ...t, ...s, ...l, push: createPushSender({ transport: t.transport, sleep: s.sleep, log: l.log }) };
};

afterEach(() => vi.restoreAllMocks());

describe("the wire payload", () => {
  it("the payload is title, body, path, tag, badge only and under 1 KB", async () => {
    const h = sender([201]);
    await h.push.send(makeTarget(), payload());
    expect(h.requests).toHaveLength(1);
    const wire = JSON.parse(h.requests[0].body) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(["badge", "body", "path", "tag", "title"]);
    expect([...WIRE_PAYLOAD_KEYS].sort()).toEqual(["badge", "body", "path", "tag", "title"]);
    expect(Buffer.byteLength(h.requests[0].body)).toBeLessThanOrEqual(1024);
    expect(MAX_WIRE_BYTES).toBe(1024);
  });
  it("maps the contract's url to path and drops v and kind from the wire", async () => {
    const h = sender([201]);
    await h.push.send(makeTarget(), payload({ url: "/dashboard/matches" }));
    const wire = JSON.parse(h.requests[0].body) as Record<string, unknown>;
    expect(wire.path).toBe("/dashboard/matches");
    expect(wire).not.toHaveProperty("url");
    expect(wire).not.toHaveProperty("v");
    expect(wire).not.toHaveProperty("kind");
  });
  it("a payload over 1 KB is never sent: pre_send_failure", async () => {
    const h = sender([201]);
    const result = await h.push.send(makeTarget(), payload({ body: "x".repeat(2000) }));
    expect(result.outcome).toBe("pre_send_failure");
    expect(h.requests).toHaveLength(0);
    expect(() => toWireJson(payload({ body: "x".repeat(2000) }))).toThrow();
  });
  it("the lock-screen copy is generic: no name, title, company, score or status, and one tag per kind", () => {
    const kinds = ["new_applicant", "application_viewed", "match_alert", "admin_message"] as const;
    const tags = new Set<string>();
    for (const kind of kinds) {
      const p = buildPushPayload(kind, { url: "/dashboard", badge: null });
      tags.add(p.tag);
      expect(`${p.title} ${p.body}`).not.toMatch(/\d|%|excellent|good|fair|hired|rejected|interview|offer|applied/i);
    }
    expect(tags.size).toBe(kinds.length);
  });
  it("a path that is not a same-origin path falls back to /dashboard", () => {
    for (const bad of ["//evil.example", "/\\evil", "https://evil.example", "javascript:alert(1)", "/ok\nbad", ""]) {
      expect(buildPushPayload("match_alert", { url: bad, badge: 1 }).url).toBe("/dashboard");
    }
    expect(buildPushPayload("match_alert", { url: "/dashboard/matches", badge: 1 }).url).toBe("/dashboard/matches");
  });
  it("TTL is 24 hours and urgency is normal", async () => {
    const h = sender([201]);
    await h.push.send(makeTarget(), payload());
    expect(PUSH_TTL_SECONDS).toBe(86_400);
    expect([h.requests[0].ttl, h.requests[0].urgency]).toEqual([86_400, "normal"]);
  });
});

describe("the failure table", () => {
  it("201 is sent, with one attempt and no wait", async () => {
    const h = sender([201]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("sent");
    expect([h.requests.length, h.delays]).toEqual([1, []]);
  });
  it.each([404, 410])("%i is gone, one attempt", async (status) => {
    const h = sender([status]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("gone");
    expect(h.requests).toHaveLength(1);
  });
  it.each([401, 403])("%i is our_key, one attempt, never gone", async (status) => {
    const h = sender([status]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("our_key");
    expect(h.requests).toHaveLength(1);
  });
  it("413 is rejected_413, one attempt", async () => {
    const h = sender([413]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("rejected_413");
    expect(h.requests).toHaveLength(1);
  });
  it("5xx retries at most 3 times, waiting 1 s, 4 s, 16 s, then releases as retries_exhausted", async () => {
    const h = sender([503]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("retries_exhausted");
    expect(h.requests).toHaveLength(4);
    expect(h.delays).toEqual([1000, 4000, 16000]);
  });
  it("a 5xx that recovers is sent", async () => {
    const h = sender([500, 502, 201]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("sent");
    expect(h.delays).toEqual([1000, 4000]);
  });
  it("a network failure backs off the same way and then releases", async () => {
    const h = sender([new Error("socket hang up")]);
    expect((await h.push.send(makeTarget(), payload())).outcome).toBe("retries_exhausted");
    expect(h.requests).toHaveLength(4);
    expect(h.delays).toEqual([1000, 4000, 16000]);
  });
  it("429 honours Retry-After once then gives up when it comes again (the wait is the header, capped at 60 s)", async () => {
    const recovers = sender([{ status: 429, retryAfter: "7" }, 201]);
    expect((await recovers.push.send(makeTarget(), payload())).outcome).toBe("sent");
    expect(recovers.delays).toEqual([7000]);
    const capped = sender([{ status: 429, retryAfter: "900" }]);
    expect((await capped.push.send(makeTarget(), payload())).outcome).toBe("retries_exhausted");
    expect(capped.requests).toHaveLength(2);
    expect(capped.delays).toEqual([60_000]);
  });
  it("429 without a usable Retry-After waits 1 s, never negative or NaN", async () => {
    for (const retryAfter of ["", "-5", "soon"]) {
      const h = sender([{ status: 429, retryAfter }, 201]);
      await h.push.send(makeTarget(), payload());
      expect(h.delays).toEqual([1000]);
    }
  });
  it("any 2xx (200, 202) is sent, not unknown: nothing is retried", async () => {
    for (const status of [200, 202]) {
      const h = sender([status]);
      expect((await h.push.send(makeTarget(), payload())).outcome).toBe("sent");
      expect(h.requests).toHaveLength(1);
    }
  });
  it("an unexpected status (302, 418) is not retried and not revoked: pre_send_failure", async () => {
    for (const status of [302, 418]) {
      const h = sender([status]);
      expect((await h.push.send(makeTarget(), payload())).outcome).toBe("pre_send_failure");
      expect(h.requests).toHaveLength(1);
    }
  });
});

describe("the sender's logs", () => {
  it("logs never contain the endpoint, keys or payload text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const target = makeTarget();
    const p = payload({ title: "SECRET-TITLE-TEXT", body: "SECRET-BODY-TEXT" });
    for (const script of [[201], [410], [403], [413], [503], [new Error(`failed to reach ${target.endpoint} using ${target.auth}`)], [{ status: 429, retryAfter: "1" }]] as const) {
      const t = scriptedTransport([...script]);
      const l = recordingLog();
      const push = createPushSender({ transport: t.transport, sleep: async () => undefined, log: l.log });
      await push.send(target, p);
      const seen = JSON.stringify(l.events) + spies.map((s) => JSON.stringify(s.mock.calls)).join("");
      for (const secret of [target.endpoint, target.p256dh, target.auth, "SECRET-TITLE-TEXT", "SECRET-BODY-TEXT", "push.example.test"]) expect(seen).not.toContain(secret);
    }
  });
  it("a log event carries the 8-hex endpoint hash and a status class, and nothing else about the device", async () => {
    const h = sender([503, 201]);
    await h.push.send(makeTarget(), payload());
    const events = h.events;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.endpointHash !== undefined) expect(event.endpointHash).toMatch(/^[0-9a-f]{8}$/);
      expect(Object.keys(event).every((k) => ["event", "endpointHash", "statusClass", "attempt", "notificationId", "counts"].includes(k))).toBe(true);
    }
    expect(events.map((e) => e.statusClass).filter(Boolean)).toEqual(["5xx", "2xx"]);
  });
});
