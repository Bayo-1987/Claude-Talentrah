/**
 * Migration 0265, part 2, THROUGH THE DATA API (N1-R26 d, N1 override 4): the ledger functions are called over HTTP (PostgREST) on the local stack that has the migration APPLIED, as the
 * service role, as a signed-in person and as an anonymous visitor. What only this path can prove: the errcode and the HINT reach the client, the message never carries an argument, the
 * grant (not a role check in a body) refuses a client role, and concurrent claims from separate connections are serialised.
 *
 * FIXTURES ARE COMMITTED (a concurrency test cannot live in one rolled-back transaction), so this file cleans up after itself and proves it: a last test deletes every row it made and
 * asserts the new tables hold exactly what they held before the file started. A failed earlier test cannot skip that test. The successful path of resolve_stale_claim is NOT called here
 * because it writes an audit event, and the audit table is append-only (its success path is proved in migration-0265-functions.test.ts, in a rolled-back transaction).
 *
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { holdSession, removeAuditRowsAsOwner, removeLedgerRowsAsOwner, requireN1Db, runN1Sql } from "./migration-0265-local-db";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
// Untyped on purpose: the generated types do not know these objects until the types are regenerated.
const svc: SupabaseClient = createClient(URL_, SERVICE, opts);
const anon: SupabaseClient = createClient(URL_, ANON, opts);

/** The generated types do not know these functions yet; the same client, seen without them. */
const untyped = (client: unknown) => client as SupabaseClient;
const GENERIC = new Set(["invalid parameter", "permission denied", "operation refused"]);
const count = (table: string) => Number(runN1Sql(`select count(*) from public.${table};`).stdout.trim());
const sql = (script: string) => {
  const r = runN1Sql(script);
  if (!r.ok) throw new Error(r.stderr);
  return r.stdout.trim();
};

type Out = { id: string | null; refused: string | null };
async function claim(client: SupabaseClient, a: Record<string, unknown>) {
  const { data, error } = await client.rpc("claim_notification", a);
  return { out: ((Array.isArray(data) ? data[0] : data) ?? null) as Out | null, error };
}

const fixtureUsers: string[] = [];
const fixtureDevices: string[] = [];
let userA: Awaited<ReturnType<typeof createAuthedTestUser>>;
let zoneOut = "";
let before = { deliveries: 0, devices: 0, events: 0 };
const settingsBefore: Record<string, number> = {};

async function device(user: string): Promise<string> {
  const id = randomUUID();
  const { error } = await svc.from("push_subscriptions").insert({ id, user_id: user, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: "k", auth: "a", ua_short: "Chrome", timezone: zoneOut });
  if (error) throw new Error(`device fixture: ${error.code}`);
  fixtureDevices.push(id);
  return id;
}
const newPerson = async (prefix: string) => {
  const u = await createAuthedTestUser(prefix);
  fixtureUsers.push(u.id);
  return u;
};

async function cleanup() {
  if (fixtureUsers.length) {
    // the service role cannot delete ledger rows by table (0273): the owner does, on the local stack only
    removeLedgerRowsAsOwner(fixtureUsers);
    await svc.from("push_subscriptions").delete().in("user_id", fixtureUsers);
  }
  await deleteTestUsers(fixtureUsers.splice(0));
  fixtureDevices.length = 0;
  for (const [key, value] of Object.entries(settingsBefore)) sql(`update public.notification_settings set int_value = ${value} where key = '${key}';`);
}

describe("the ledger functions through the Data API (committed fixtures, cleaned up)", () => {
  beforeAll(async () => {
    requireN1Db();
    before = { deliveries: count("notification_deliveries"), devices: count("push_subscriptions"), events: count("admin_message_events") };
    for (const line of sql("select key || '=' || int_value from public.notification_settings;").split("\n")) {
      const [k, v] = line.split("=");
      settingsBefore[k] = Number(v);
    }
    zoneOut = sql("select n.name from pg_catalog.pg_timezone_names n where (now() at time zone n.name)::time between time '09:00' and time '19:00' order by n.name limit 1;");
    userA = await newPerson("n1-api-a");
    // PostgREST may need a moment to see functions applied just before this file ran.
    for (let i = 0; i < 30; i++) {
      const { error } = await svc.rpc("release_notification", { p_id: randomUUID(), p_reason: "gone" });
      if (error?.code === "P0001") break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 120_000);
  afterAll(cleanup, 120_000);

  it("the table holds nothing from another run before this one starts", () => {
    expect(before).toEqual({ deliveries: 0, devices: 0, events: 0 });
  });

  describe("errcodes, hints and generic messages", () => {
    it("an unknown id to release_notification is P0001 with the hint unknown_id", async () => {
      const { error } = await svc.rpc("release_notification", { p_id: randomUUID(), p_reason: "gone" });
      expect([error?.code, error?.hint]).toEqual(["P0001", "unknown_id"]);
    });
    it("releasing an e-mail claim is 42501 with the hint email_release_refused", async () => {
      const subject = randomUUID();
      const made = await claim(svc, { p_user: userA.id, p_kind: "match_alert", p_subject: subject, p_channel: "email" });
      expect(made.out?.id).toBeTruthy();
      const { error } = await svc.rpc("release_notification", { p_id: made.out!.id, p_reason: "gone" });
      expect([error?.code, error?.hint]).toEqual(["42501", "email_release_refused"]);
    });
    it("an unknown release reason is 22023 with the hint invalid_release_reason", async () => {
      const made = await claim(svc, { p_user: userA.id, p_kind: "match_alert", p_subject: randomUUID(), p_channel: "inapp" });
      const { error } = await svc.rpc("release_notification", { p_id: made.out!.id, p_reason: "because" });
      expect([error?.code, error?.hint]).toEqual(["22023", "invalid_release_reason"]);
    });
    it("mark_notification_sent on an unknown id is P0001 with the hint not_found", async () => {
      const { error } = await svc.rpc("mark_notification_sent", { p_id: randomUUID() });
      expect([error?.code, error?.hint]).toEqual(["P0001", "not_found"]);
    });
    it("an unknown kind or channel, a negative window, a negative stale age and a bad prune limit are 22023", async () => {
      expect((await claim(svc, { p_user: userA.id, p_kind: "bogus", p_subject: randomUUID(), p_channel: "inapp" })).error?.code).toBe("22023");
      expect((await claim(svc, { p_user: userA.id, p_kind: "match_alert", p_subject: randomUUID(), p_channel: "sms" })).error?.code).toBe("22023");
      expect((await claim(svc, { p_user: userA.id, p_kind: "match_alert", p_subject: randomUUID(), p_channel: "inapp", p_window: "-1 hour" })).error?.code).toBe("22023");
      expect((await svc.rpc("stale_notification_claims", { p_channel: "email", p_older_than: "-1 hour" })).error?.code).toBe("22023");
      expect((await svc.rpc("prune_notification_deliveries", { p_older_than_days: 0 })).error?.code).toBe("22023");
      expect((await svc.rpc("prune_notification_deliveries", { p_older_than_days: null })).error?.code).toBe("22023");
    });
    it("resolve_stale_claim without the permission is 42501 (a person who is no admin, a null actor)", async () => {
      const a = await svc.rpc("resolve_stale_claim", { p_id: randomUUID(), p_actor: userA.id, p_resolution: "mark_sent" });
      expect(a.error?.code).toBe("42501");
      const b = await svc.rpc("resolve_stale_claim", { p_id: randomUUID(), p_actor: null, p_resolution: "mark_sent" });
      expect(b.error?.code).toBe("42501");
    });
    it("the message is one of three generic texts and never carries an argument value", async () => {
      const subject = randomUUID();
      const errors = [
        (await svc.rpc("release_notification", { p_id: subject, p_reason: "secret-reason-value" })).error,
        (await claim(svc, { p_user: userA.id, p_kind: "leaky-kind-value", p_subject: subject, p_channel: "inapp" })).error,
        (await svc.rpc("resolve_stale_claim", { p_id: subject, p_actor: userA.id, p_resolution: "mark_sent" })).error,
      ];
      for (const e of errors) {
        expect(e).toBeTruthy();
        expect(GENERIC.has(e!.message), e!.message).toBe(true);
        expect(`${e!.message} ${e!.details ?? ""}`).not.toMatch(new RegExp(`${subject}|secret-reason-value|leaky-kind-value|${userA.id}`));
      }
    });
  });

  describe("client roles are refused by the grant (42501), not by a role check in a body", () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["claim_notification", { p_user: randomUUID(), p_kind: "match_alert", p_subject: randomUUID(), p_channel: "inapp" }],
      ["release_notification", { p_id: randomUUID(), p_reason: "gone" }],
      ["mark_notification_sent", { p_id: randomUUID() }],
      ["stale_notification_claims", { p_channel: "email", p_older_than: "1 hour" }],
      ["resolve_stale_claim", { p_id: randomUUID(), p_actor: randomUUID(), p_resolution: "mark_sent" }],
      ["unread_notification_count", { p_user: randomUUID() }],
      ["prune_notification_deliveries", { p_older_than_days: 30 }],
      ["resolve_admin_segment", { p_key: "everyone", p_params: {}, p_actor: randomUUID() }],
      ["prepare_admin_message", { p_message: randomUUID(), p_actor: randomUUID(), p_max_audience: 10 }],
      ["submit_admin_message", { p_message: randomUUID(), p_actor: randomUUID() }],
      ["approve_admin_message", { p_message: randomUUID(), p_actor: randomUUID(), p_kind_confirmed: "promotion" }],
      ["cancel_admin_message", { p_message: randomUUID(), p_actor: randomUUID() }],
      ["start_admin_message_send", { p_message: randomUUID(), p_actor: randomUUID() }],
      ["admin_message_audit", { p_actor: randomUUID() }],
      ["record_admin_message_test", { p_message: randomUUID(), p_actor: randomUUID() }],
      ["set_notification_setting", { p_key: "mass_email_cap_24h", p_value: 5, p_actor: randomUUID() }],
      ["pause_admin_message_send", { p_message: randomUUID(), p_reason: "cap_24h" }],
      ["resume_admin_message_send", { p_message: randomUUID(), p_actor: randomUUID() }],
      ["admin_email_eligible_recipients", { p_user_ids: [], p_stream: "announcements" }],
    ];
    it.each(calls)("%s: an anonymous visitor and a signed-in person are both refused", async (name, a) => {
      const anonymous = await anon.rpc(name, a);
      const signedIn = await untyped(userA.client).rpc(name, a);
      // PostgREST answers a function the role cannot execute with 42501 (permission denied) or, when it hides the function entirely, PGRST202.
      for (const res of [anonymous, signedIn]) expect(["42501", "PGRST202"], `${name}: ${res.error?.code}`).toContain(res.error?.code);
      expect(anonymous.data ?? null).toBeNull();
      expect(signedIn.data ?? null).toBeNull();
    });
    it("a person cannot call the quiet-hours predicate either", async () => {
      const res = await untyped(userA.client).rpc("notification_in_quiet_hours", { p_instant: new Date().toISOString(), p_zone: "UTC" });
      expect(["42501", "PGRST202"]).toContain(res.error?.code);
      const service = await svc.rpc("notification_in_quiet_hours", { p_instant: new Date().toISOString(), p_zone: "UTC" });
      expect(["42501", "PGRST202"]).toContain(service.error?.code);
    });
  });

  describe("concurrent claims from separate connections are serialised (N1-R1)", () => {
    it("10 identical concurrent claims: exactly one wins, the others say already_claimed", async () => {
      const subject = randomUUID();
      const results = await Promise.all(Array.from({ length: 10 }, () => claim(svc, { p_user: userA.id, p_kind: "new_applicant", p_subject: subject, p_channel: "inapp" })));
      expect(results.map((r) => r.error?.code ?? null)).toEqual(Array(10).fill(null));
      expect(results.filter((r) => r.out?.id).length).toBe(1);
      expect(results.filter((r) => r.out?.refused === "already_claimed").length).toBe(9);
    }, 60_000);

    it("two concurrent claims for two new events at the cap minus one: exactly one succeeds", async () => {
      const person = await newPerson("n1-api-cap");
      const dev = await device(person.id);
      const first = await Promise.all([1, 2].map(() => claim(svc, { p_user: person.id, p_kind: "match_alert", p_subject: randomUUID(), p_channel: "push", p_device: dev })));
      expect(first.every((r) => r.out?.id)).toBe(true);
      const race = await Promise.all([1, 2].map(() => claim(svc, { p_user: person.id, p_kind: "match_alert", p_subject: randomUUID(), p_channel: "push", p_device: dev })));
      expect(race.filter((r) => r.out?.id).length).toBe(1);
      expect(race.filter((r) => r.out?.refused === "budget_cap").length).toBe(1);
    }, 60_000);

    it("20 concurrent push claims for one person admit exactly the cap of three", async () => {
      const person = await newPerson("n1-api-burst");
      const dev = await device(person.id);
      const results = await Promise.all(Array.from({ length: 20 }, () => claim(svc, { p_user: person.id, p_kind: "match_alert", p_subject: randomUUID(), p_channel: "push", p_device: dev })));
      expect(results.filter((r) => r.out?.id).length).toBe(3);
      expect(results.filter((r) => r.out?.refused === "budget_cap").length).toBe(17);
    }, 60_000);

    it("20 concurrent admin e-mail claims at the cap boundary admit exactly the cap", async () => {
      const person = await newPerson("n1-api-mail");
      sql("update public.notification_settings set int_value = 5 where key = 'mass_email_cap_24h'; update public.notification_settings set int_value = 1000 where key = 'mass_email_ceiling_month';");
      const results = await Promise.all(Array.from({ length: 20 }, () => claim(svc, { p_user: person.id, p_kind: "admin_message", p_subject: randomUUID(), p_channel: "email" })));
      expect(results.filter((r) => r.out?.id).length).toBe(5);
      expect(results.filter((r) => r.out?.refused === "cap_24h").length).toBe(15);
    }, 60_000);
  });

  describe("register_push_subscription: the signed-in person's own call, over HTTP", () => {
    const endpoint = (n: number | string) => `https://fcm.googleapis.com/fcm/send/api-${randomUUID()}-${n}`;
    const args = (over: Record<string, unknown> = {}) => ({ p_endpoint: endpoint("x"), p_p256dh: "k", p_auth: "a", p_ua: "Chrome on Android", ...over });
    it("an anonymous visitor and the service role are refused by the grant (42501), not by a check in the body", async () => {
      for (const client of [anon, svc]) {
        const res = await client.rpc("register_push_subscription", args());
        expect(["42501", "PGRST202"], String(res.error?.code)).toContain(res.error?.code);
        expect(res.data ?? null).toBeNull();
      }
    });
    it("a signed-in person registers a device for THEMSELVES: the id comes back, the row is theirs, and the zone defaults to Africa/Lagos", async () => {
      const person = await newPerson("n1-api-reg");
      const ep = endpoint("own");
      const { data, error } = await untyped(person.client).rpc("register_push_subscription", args({ p_endpoint: ep }));
      expect(error).toBeNull();
      expect(typeof data).toBe("string");
      const row = await svc.from("push_subscriptions").select("user_id, timezone, ua_short").eq("endpoint", ep).single();
      expect(row.data).toEqual({ user_id: person.id, timezone: "Africa/Lagos", ua_short: "Chrome on Android" });
    });
    it("the refusals carry their errcode and HINT, and the message is one of the three generic texts without any value", async () => {
      const person = await newPerson("n1-api-reg-bad");
      const call = (over: Record<string, unknown>) => untyped(person.client).rpc("register_push_subscription", args(over));
      const marker = "endpoint-marker-value";
      const cases: Array<[Record<string, unknown>, string, string | null]> = [
        [{ p_endpoint: `http://fcm.googleapis.com/${marker}` }, "P0001", "not_https"],
        [{ p_endpoint: `https://${"x".repeat(2049 - 8)}` }, "P0001", "value_too_long"],
        [{ p_ua: "u".repeat(41) }, "P0001", "value_too_long"],
        [{ p_timezone: "Mars/Olympus" }, "22023", null],
        [{ p_auth: null }, "22023", null],
      ];
      for (const [over, code, hint] of cases) {
        const { error } = await call(over);
        expect([error?.code, error?.hint ?? null], JSON.stringify(Object.keys(over))).toEqual([code, hint]);
        expect(GENERIC.has(error!.message), error!.message).toBe(true);
        expect(`${error!.message} ${error!.details ?? ""}`).not.toContain(marker);
      }
    });
    it("the eleventh active device is P0001 device_limit; one more after a delete of their own is accepted", async () => {
      const person = await newPerson("n1-api-reg-limit");
      const eps = Array.from({ length: 10 }, (_, i) => endpoint(i));
      const ids: string[] = [];
      for (const e of eps) {
        const made = await untyped(person.client).rpc("register_push_subscription", args({ p_endpoint: e }));
        expect(made.error).toBeNull();
        ids.push(made.data as string);
      }
      const over = await untyped(person.client).rpc("register_push_subscription", args({ p_endpoint: endpoint("eleven") }));
      expect([over.error?.code, over.error?.hint]).toEqual(["P0001", "device_limit"]);
      // The endpoint is a credential the person cannot even filter on; they delete by the id the call returned.
      const del = await untyped(person.client).from("push_subscriptions").delete().eq("id", ids[0]);
      expect(del.error).toBeNull();
      expect((await untyped(person.client).rpc("register_push_subscription", args({ p_endpoint: endpoint("eleven-b") }))).error).toBeNull();
    }, 60_000);
    it("15 concurrent registrations of new endpoints by one signed-in session admit exactly ten", async () => {
      const person = await newPerson("n1-api-reg-race");
      const results = await Promise.all(Array.from({ length: 15 }, (_, i) => untyped(person.client).rpc("register_push_subscription", args({ p_endpoint: endpoint(`race${i}`) }))));
      expect(results.filter((r) => !r.error).length).toBe(10);
      expect(results.filter((r) => r.error?.code === "P0001" && r.error?.hint === "device_limit").length).toBe(5);
      const held = await svc.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", person.id).is("revoked_at", null);
      expect(held.count).toBe(10);
    }, 60_000);
  });

  describe("two sessions at once (N1-R31): the registration limit and the send limits hold across connections", () => {
    it("a registration that waits on another session's open registration of the same person sees the tenth device and is refused (the per-person lock)", async () => {
      const person = await newPerson("n1-api-two-reg");
      for (let i = 0; i < 9; i++) await device(person.id);
      const held = await holdSession(
        `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${person.id}","role":"authenticated"}', true); select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/hold-${randomUUID()}', 'k', 'a', 'Chrome', null);`,
      );
      const second = await untyped(person.client).rpc("register_push_subscription", { p_endpoint: `https://fcm.googleapis.com/fcm/send/second-${randomUUID()}`, p_p256dh: "k", p_auth: "a", p_ua: "Chrome" });
      await held.done;
      expect([second.error?.code, second.error?.hint]).toEqual(["P0001", "device_limit"]);
      expect(sql(`select count(*) from public.push_subscriptions where user_id = '${person.id}' and revoked_at is null;`)).toBe("10");
    }, 60_000);
  });

  describe("two sessions at once (N1B): one endpoint registered by two people", () => {
    it("a registration that waits on another person's open registration of the same NEW endpoint takes it over cleanly, not as a duplicate-key error (the endpoint lock)", async () => {
      const first = await newPerson("n1-api-ep-a");
      const second = await newPerson("n1-api-ep-b");
      const shared = `https://fcm.googleapis.com/fcm/send/shared-${randomUUID()}`;
      const held = await holdSession(
        `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${first.id}","role":"authenticated"}', true); select public.register_push_subscription('${shared}', 'k', 'a', 'Chrome', null);`,
      );
      const taken = await untyped(second.client).rpc("register_push_subscription", { p_endpoint: shared, p_p256dh: "k2", p_auth: "a2", p_ua: "Chrome" });
      await held.done;
      expect(taken.error).toBeNull();
      expect(sql(`select user_id from public.push_subscriptions where endpoint = '${shared}' and revoked_at is null;`)).toBe(second.id);
      expect(sql(`select revoke_reason || '/' || (endpoint like 'https://revoked.invalid/%')::text from public.push_subscriptions where user_id = '${first.id}';`)).toBe("user/true");
    }, 60_000);
  });

  describe("the admin functions over HTTP: errcodes, hints, generic messages and a double start", () => {
    const FLAG_KEYS = ["notifications_master", "admin_messaging", "admin_promotions", "admin_email"];
    const flagsBefore: Record<string, boolean> = {};
    const messageIds: string[] = [];
    let operator: Awaited<ReturnType<typeof newPerson>>;
    let roleId = "";
    let outsider: Awaited<ReturnType<typeof newPerson>>;
    const setFlags = (on: boolean) => sql(`update public.feature_flags set enabled = ${on} where key in (${FLAG_KEYS.map((k) => `'${k}'`).join(", ")});`);
    const newMessage = (status: string, extra = "") => {
      const id = randomUUID();
      messageIds.push(id);
      sql(`insert into public.admin_messages (id, created_by, created_by_email, kind, title, body, channels, segment_key, status, requires_approval ${extra ? ", " + extra.split("=")[0] : ""}) values ('${id}', '${operator.id}', 'op@example.test', 'service_announcement', 'T', 'B', array['inapp'], 'self_test', '${status}', false ${extra ? ", " + extra.split("=")[1] : ""});`);
      return id;
    };
    beforeAll(async () => {
      for (const line of sql(`select key || '=' || enabled from public.feature_flags where key in (${FLAG_KEYS.map((k) => `'${k}'`).join(", ")});`).split("\n")) {
        const [k, v] = line.split("=");
        flagsBefore[k] = v === "true";
      }
      operator = await newPerson("n1-api-op");
      outsider = await newPerson("n1-api-out");
      roleId = randomUUID();
      sql(`insert into public.admin_users (id, email) values ('${operator.id}', '${operator.email}'); insert into public.admin_roles (id, name) values ('${roleId}', 'n1-api-${roleId.slice(0, 8)}'); update public.admin_users set role_id = '${roleId}' where id = '${operator.id}'; insert into public.admin_role_permissions (role_id, permission) values ('${roleId}', 'user_messaging');`);
      setFlags(true);
    }, 120_000);
    afterAll(() => {
      for (const [k, v] of Object.entries(flagsBefore)) sql(`update public.feature_flags set enabled = ${v} where key = '${k}';`);
      if (messageIds.length) {
        // the audit table is append-only: only the table's owner, with triggers off for this one session, can remove the rows this file made
        removeAuditRowsAsOwner(messageIds);
      }
      // the operator's role and its permission are rows other suites read (the enum test reads the permission table), so they go too, the admin first
      if (roleId) sql(`delete from public.admin_users where id = '${operator.id}'; delete from public.admin_role_permissions where role_id = '${roleId}'; delete from public.admin_roles where id = '${roleId}';`);
    }, 120_000);

    it("a person who holds no permission is refused with 42501 and the generic message", async () => {
      const m = newMessage("draft");
      const { error } = await svc.rpc("prepare_admin_message", { p_message: m, p_actor: outsider.id, p_max_audience: 10 });
      expect([error?.code, error?.message]).toEqual(["42501", "permission denied"]);
    });
    it("a flag off, an unknown message, a bad segment and a bad setting carry their errcode and HINT", async () => {
      const m = newMessage("draft");
      setFlags(false);
      const off = await svc.rpc("prepare_admin_message", { p_message: m, p_actor: operator.id, p_max_audience: 10 });
      setFlags(true);
      expect([off.error?.code, off.error?.hint]).toEqual(["P0001", "flag_off"]);
      const unknown = await svc.rpc("submit_admin_message", { p_message: randomUUID(), p_actor: operator.id });
      expect([unknown.error?.code, unknown.error?.hint]).toEqual(["P0001", "not_found"]);
      const segment = await svc.rpc("resolve_admin_segment", { p_key: "admins", p_params: {}, p_actor: operator.id });
      expect(segment.error?.code).toBe("22023");
      const nullActor = await svc.rpc("resolve_admin_segment", { p_key: "everyone", p_params: {}, p_actor: null });
      expect(nullActor.error?.code).toBe("22023");
      const setting = await svc.rpc("set_notification_setting", { p_key: "mass_email_cap_24h", p_value: 5, p_actor: operator.id });
      expect([setting.error?.code, setting.error?.message]).toEqual(["42501", "permission denied"]);
      for (const e of [off.error, unknown.error, segment.error, nullActor.error]) {
        expect(GENERIC.has(e!.message), e!.message).toBe(true);
        expect(`${e!.message} ${e!.details ?? ""}`).not.toContain(operator.id);
      }
    });
    it("N1B (0273) over HTTP: the service role cannot write the messages, the audit rows or the ledger by table (42501); the create function sets the creator and the creator cannot approve", async () => {
      const hand = await svc.from("admin_messages").insert({ kind: "service_announcement", title: "t", body: "b", channels: ["inapp"], segment_key: "self_test", created_by_email: "x@example.test" });
      expect(hand.error?.code).toBe("42501");
      const event = await svc.from("admin_message_events").insert({ event: "approved" });
      expect(event.error?.code).toBe("42501");
      const ledger = await svc.from("notification_deliveries").delete().eq("user_id", userA.id);
      expect(ledger.error?.code).toBe("42501");
      const made = await svc.rpc("create_admin_message", { p_actor: operator.id, p_kind: "service_announcement", p_title: "T", p_body: "B", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null });
      expect(made.error).toBeNull();
      const id = made.data as string;
      messageIds.push(id);
      expect(sql(`select created_by || '/' || status from public.admin_messages where id = '${id}';`)).toBe(`${operator.id}/draft`);
      expect((await svc.rpc("prepare_admin_message", { p_message: id, p_actor: operator.id, p_max_audience: 10 })).error).toBeNull();
      expect((await svc.rpc("submit_admin_message", { p_message: id, p_actor: operator.id })).error).toBeNull();
      const self = await svc.rpc("approve_admin_message", { p_message: id, p_actor: operator.id, p_kind_confirmed: "service_announcement" });
      expect([self.error?.code, self.error?.hint]).toEqual(["P0001", "self_approval"]);
      const bad = await svc.rpc("create_admin_message", { p_actor: operator.id, p_kind: "leaky-kind-value", p_title: "T", p_body: "B", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null });
      expect([bad.error?.code, bad.error?.message]).toEqual(["22023", "invalid parameter"]);
    });
    it("a prepare over HTTP returns the frozen count, and a repeat is invalid_state", async () => {
      const m = newMessage("draft");
      const first = await svc.rpc("prepare_admin_message", { p_message: m, p_actor: operator.id, p_max_audience: 10 });
      expect([first.error, first.data]).toEqual([null, 1]);
      const again = await svc.rpc("prepare_admin_message", { p_message: m, p_actor: operator.id, p_max_audience: 10 });
      expect([again.error?.code, again.error?.hint]).toEqual(["P0001", "invalid_state"]);
    });
    it("5 concurrent prepares of one draft: exactly one succeeds, the others are invalid_state and no recipient row is duplicated", async () => {
      const m = newMessage("draft");
      const results = await Promise.all(Array.from({ length: 5 }, () => svc.rpc("prepare_admin_message", { p_message: m, p_actor: operator.id, p_max_audience: 10 })));
      expect(results.filter((r) => !r.error).length).toBe(1);
      expect(results.filter((r) => r.error?.code === "P0001" && r.error?.hint === "invalid_state").length).toBe(4);
      expect(sql(`select count(*) from public.admin_message_recipients where message_id = '${m}';`)).toBe("1");
    }, 60_000);
    it("a prepare that waits on another session's open prepare of the same draft ends as invalid_state, not as a duplicate-row error (the message row is locked)", async () => {
      const m = newMessage("draft");
      const held = await holdSession(`begin; select public.prepare_admin_message('${m}', '${operator.id}', 10);`);
      const second = await svc.rpc("prepare_admin_message", { p_message: m, p_actor: operator.id, p_max_audience: 10 });
      await held.done;
      expect([second.error?.code, second.error?.hint]).toEqual(["P0001", "invalid_state"]);
      expect(sql(`select count(*) from public.admin_message_recipients where message_id = '${m}';`)).toBe("1");
    }, 60_000);
    it("10 concurrent starts of one prepared message: exactly one wins, the others get nothing, and one event is written", async () => {
      const m = newMessage("prepared");
      const results = await Promise.all(Array.from({ length: 10 }, () => svc.rpc("start_admin_message_send", { p_message: m, p_actor: operator.id })));
      expect(results.map((r) => r.error?.code ?? null)).toEqual(Array(10).fill(null));
      expect(results.filter((r) => r.data === m).length).toBe(1);
      expect(results.filter((r) => r.data === null).length).toBe(9);
      expect(sql(`select count(*) from public.admin_message_events where message_id = '${m}' and event = 'send_started';`)).toBe("1");
    }, 60_000);
    it("a start that waits on another session's open start takes the lock, sees the fifth start and is refused with operator_daily_limit, leaving the message prepared (F1)", async () => {
      // bring the operator to exactly four starts inside the last day (earlier tests in this block may have made some)
      const already = Number(sql(`select count(*) from public.admin_messages where created_by = '${operator.id}' and sent_started_at > now() - interval '24 hours';`));
      for (let i = 0; i < 4 - already; i++) {
        const id = randomUUID();
        messageIds.push(id);
        sql(`insert into public.admin_messages (id, created_by, created_by_email, kind, title, body, channels, segment_key, status, requires_approval, sent_started_at) values ('${id}', '${operator.id}', 'op@example.test', 'service_announcement', 'T', 'B', array['inapp'], 'self_test', 'sent', false, now() - interval '1 hour');`);
      }
      const first = newMessage("prepared");
      const second = newMessage("prepared");
      const held = await holdSession(`begin; select public.start_admin_message_send('${first}', '${operator.id}');`);
      const refused = await svc.rpc("start_admin_message_send", { p_message: second, p_actor: operator.id });
      await held.done;
      expect([refused.error?.code, refused.error?.hint]).toEqual(["P0001", "operator_daily_limit"]);
      expect(sql(`select status from public.admin_messages where id = '${second}';`)).toBe("prepared");
      expect(sql(`select status from public.admin_messages where id = '${first}';`)).toBe("sending");
    }, 60_000);
    it("a start that waits on another session's open start with a flag off sees that session's stop and writes none of its own (the per-message lock, F8)", async () => {
      const m = newMessage("approved");
      sql(`update public.feature_flags set enabled = false where key = 'admin_messaging';`);
      try {
        const held = await holdSession(`begin; select public.start_admin_message_send('${m}', '${operator.id}');`);
        const second = await svc.rpc("start_admin_message_send", { p_message: m, p_actor: operator.id });
        await held.done;
        expect(second.error).toBeNull();
        expect(second.data).toBeNull();
        expect(sql(`select count(*) || '/' || min(flag_state) from public.admin_message_events where message_id = '${m}' and event = 'flag_stopped';`)).toBe("1/2");
      } finally {
        sql(`update public.feature_flags set enabled = true where key = 'admin_messaging';`);
      }
    }, 60_000);
  });

  it("cleans up after itself: every fixture row is gone and the tables hold what they held before this file started", async () => {
    await cleanup();
    expect({ deliveries: count("notification_deliveries"), devices: count("push_subscriptions"), events: count("admin_message_events") }).toEqual(before);
    expect(sql("select string_agg(key || '=' || int_value, ',' order by key) from public.notification_settings;")).toBe(
      Object.entries(settingsBefore).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(","),
    );
  }, 120_000);
});
