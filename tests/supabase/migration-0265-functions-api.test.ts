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
import { requireN1Db, runN1Sql } from "./migration-0265-local-db";

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
  const { error } = await svc.from("push_subscriptions").insert({ id, user_id: user, endpoint: `https://push.example.invalid/${id}`, p256dh: "k", auth: "a", ua_short: "Chrome", timezone: zoneOut });
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
    await svc.from("notification_deliveries").delete().in("user_id", fixtureUsers);
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
        (await claim(svc, { p_user: userA.id, p_kind: "secret-kind-value", p_subject: subject, p_channel: "inapp" })).error,
        (await svc.rpc("resolve_stale_claim", { p_id: subject, p_actor: userA.id, p_resolution: "mark_sent" })).error,
      ];
      for (const e of errors) {
        expect(e).toBeTruthy();
        expect(GENERIC.has(e!.message), e!.message).toBe(true);
        expect(`${e!.message} ${e!.details ?? ""}`).not.toMatch(new RegExp(`${subject}|secret-reason-value|secret-kind-value|${userA.id}`));
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

  it("cleans up after itself: every fixture row is gone and the tables hold what they held before this file started", async () => {
    await cleanup();
    expect({ deliveries: count("notification_deliveries"), devices: count("push_subscriptions"), events: count("admin_message_events") }).toEqual(before);
    expect(sql("select string_agg(key || '=' || int_value, ',' order by key) from public.notification_settings;")).toBe(
      Object.entries(settingsBefore).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(","),
    );
  }, 120_000);
});
