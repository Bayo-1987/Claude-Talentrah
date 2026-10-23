/**
 * Migration 0265, part 3: the push device registration and lifecycle (prompt 01 section 2.4), the preference columns and the stream unsubscribe (2.5), and the five flags (2.6).
 * Replayed in a private scratch database in rolled-back transactions; the person's calls run as `authenticated` with the JWT claims, so `auth.uid()` is the person and a refusal is the
 * database's own. Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { ZONE_INVALID_BOTH, ZONE_INVALID_DB_ONLY, ZONE_VALID } from "../support/n1-zone-cases";
import { D1, D2, FIXTURES, R0265, U1, U2, asRole, probe, readRollback, replay0265, rowsOf, scalar } from "./migration-0265-support";

const ep = (n: number | string) => `https://fcm.googleapis.com/fcm/send/${n}`;
const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
const call = (endpoint: string | null, opts: { p256dh?: string | null; auth?: string | null; ua?: string | null; zone?: string | null | undefined } = {}) =>
  `public.register_push_subscription(p_endpoint => ${lit(endpoint)}, p_p256dh => ${lit(opts.p256dh === undefined ? "k" : opts.p256dh)}, p_auth => ${lit(opts.auth === undefined ? "a" : opts.auth)}, p_ua => ${lit(opts.ua === undefined ? "Chrome on Android" : opts.ua)}${opts.zone === undefined ? "" : `, p_timezone => ${lit(opts.zone)}`})`;
const reg = (name: string, endpoint: string, opts: Parameters<typeof call>[1] = {}) => `select 'R|${name}|' || (case when ${call(endpoint, opts)} is not null then 'id' else 'null' end);`;
/** Between role blocks the owner clears the throwaway registrations, so a long script never reaches the ten-device limit (the person holds DELETE but no SELECT, so cannot delete by endpoint). */
const CLEAR_TMP = "delete from public.push_subscriptions where endpoint not in ('https://fcm.googleapis.com/fcm/send/1', 'https://fcm.googleapis.com/fcm/send/2', 'https://fcm.googleapis.com/fcm/send/3', 'https://fcm.googleapis.com/fcm/send/4');";
const x = (n: number) => "x".repeat(n);
const asU1 = (lines: string[]) => asRole("authenticated", lines, U1);
const asU2 = (lines: string[]) => asRole("authenticated", lines, U2);
const dev = (id: string, user: string, endpoint: string, extra = "") =>
  `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short${extra ? ", " + extra.split("=")[0] : ""}) values ('${id}', '${user}', '${endpoint}', 'k', 'a', 'Chrome'${extra ? ", " + extra.split("=")[1] : ""});`;

describe("register_push_subscription: validation, in the fake's order", () => {
  const body = [
    FIXTURES,
    asU1([
      reg("ok_default", ep(1)),
      reg("ok_null_zone", ep(2), { zone: null }),
      reg("ok_empty_zone", ep(3), { zone: "" }),
      reg("ok_kolkata", ep(4), { zone: "Asia/Kolkata" }),
      ...ZONE_VALID.slice(0, 5).map((z, i) => reg(`zone_ok_${i}`, ep(`z${i}`), { zone: z })),
    ]),
    CLEAR_TMP,
    asU1([
      ...ZONE_VALID.slice(5).map((z, i) => reg(`zone_ok_${i + 5}`, ep(`z${i + 5}`), { zone: z })),
      probe("not_https", `select ${call("http://fcm.googleapis.com/x")}`, "P0001", "not_https"),
      probe("not_https_upper", `select ${call("HTTPS://fcm.googleapis.com/x")}`, "P0001", "not_https"),
      probe("not_https_first", `select ${call("http://" + x(2100))}`, "P0001", "not_https"),
      reg("endpoint_2048", "https://fcm.googleapis.com/" + x(2048 - 27)),
    ]),
    CLEAR_TMP,
    asU1([
      probe("endpoint_2049", `select ${call("https://fcm.googleapis.com/" + x(2049 - 27))}`, "P0001", "value_too_long"),
      reg("p256dh_256", ep(10), { p256dh: x(256) }),
      probe("p256dh_257", `select ${call(ep(11), { p256dh: x(257) })}`, "P0001", "value_too_long"),
      reg("auth_256", ep(12), { auth: x(256) }),
      probe("auth_257", `select ${call(ep(13), { auth: x(257) })}`, "P0001", "value_too_long"),
      reg("ua_40", ep(14), { ua: x(40) }),
      probe("ua_41", `select ${call(ep(15), { ua: x(41) })}`, "P0001", "value_too_long"),
      probe("length_before_zone", `select ${call(ep(16), { ua: x(41), zone: "Mars/Olympus" })}`, "P0001", "value_too_long"),
      ...ZONE_INVALID_BOTH.concat(ZONE_INVALID_DB_ONLY).map((z, i) => probe(`zone_bad_${i}`, `select ${call(ep(`b${i}`), { zone: z })}`, "22023")),
      probe("null_endpoint", `select ${call(null)}`, "22023"),
      probe("null_key", `select ${call(ep(20), { p256dh: null })}`, "22023"),
      probe("null_auth", `select ${call(ep(21), { auth: null })}`, "22023"),
      probe("null_ua", `select ${call(ep(22), { ua: null })}`, "22023"),
    ]),
    scalar("stored_zones", `select string_agg(endpoint || '=' || timezone, ',' order by endpoint) from public.push_subscriptions where endpoint in ('${ep(1)}', '${ep(2)}', '${ep(3)}', '${ep(4)}')`),
    scalar("stored_row", `select user_id || '/' || ua_short || '/' || (last_seen_at is not null)::text || '/' || coalesce(revoked_at::text, 'none') from public.push_subscriptions where endpoint = '${ep(1)}'`),
    scalar("refused_stored_nothing", `select count(*) from public.push_subscriptions where endpoint like '%/b%' or endpoint = 'http://fcm.googleapis.com/x' or endpoint = '${ep(11)}'`),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a valid registration returns the device id; a missing or empty zone is stored as Africa/Lagos, a given zone as given", () => {
    for (const k of ["ok_default", "ok_null_zone", "ok_empty_zone", "ok_kolkata"]) expect(r.res[k], k).toBe("id");
    expect(r.res.stored_zones).toBe(`${ep(1)}=Africa/Lagos,${ep(2)}=Africa/Lagos,${ep(3)}=Africa/Lagos,${ep(4)}=Asia/Kolkata`);
  });
  it("the row belongs to the caller and records the browser and the time of registration", () => expect(r.res.stored_row).toBe(`${U1}/Chrome on Android/true/none`));
  it("every zone name Postgres knows is accepted", () => ZONE_VALID.forEach((z, i) => expect(r.res[`zone_ok_${i}`], z).toBe("id")));
  it("an endpoint that is not https (any case but https://) is P0001 not_https, and that check comes first", () => {
    for (const k of ["not_https", "not_https_upper", "not_https_first"]) expect(r.res[k], k).toBe("ok");
  });
  it("the length caps are exact: endpoint 2048, p256dh and auth 256, browser 40; one more is P0001 value_too_long, and that check comes before the zone check", () => {
    for (const k of ["endpoint_2048", "p256dh_256", "auth_256", "ua_40"]) expect(r.res[k], k).toBe("id");
    for (const k of ["endpoint_2049", "p256dh_257", "auth_257", "ua_41", "length_before_zone"]) expect(r.res[k], k).toBe("ok");
  });
  it("a zone that is not in pg_timezone_names (unknown, offset, padded, abbreviation, wrong case, too long) is 22023 and nothing is stored", () => {
    ZONE_INVALID_BOTH.concat(ZONE_INVALID_DB_ONLY).forEach((z, i) => expect(r.res[`zone_bad_${i}`], JSON.stringify(z)).toBe("ok"));
    expect(r.res.refused_stored_nothing).toBe("0");
  });
  it("a null endpoint, key, secret or browser raises 22023 (the function is not strict)", () => {
    for (const k of ["null_endpoint", "null_key", "null_auth", "null_ua"]) expect(r.res[k], k).toBe("ok");
  });
});

describe("register_push_subscription: who may call it, the device limit and the re-bind", () => {
  const N = Array.from({ length: 10 }, (_, i) => i + 1);
  const CLAIM = "00000000-0000-4000-8000-0000000000c9";
  const SUBJECT = "00000000-0000-4000-8000-0000000000f9";
  const body = [
    FIXTURES,
    asRole("anon", [probe("anon", `select ${call(ep(1))}`, "42501")]),
    asRole("service_role", [probe("service_role", `select ${call(ep(1))}`, "42501")]),
    asRole("authenticated", [probe("no_session_subject", `select ${call(ep(1))}`, "42501")]),
    // the limit: ten active devices are fine, the eleventh is refused
    asU1(N.map((n) => reg(`d${n}`, ep(`lim${n}`)))),
    asU1([probe("eleventh", `select ${call(ep("lim11"))}`, "P0001", "device_limit")]),
    `select set_config('n1.id3', (select id::text from public.push_subscriptions where endpoint = '${ep("lim3")}'), false);`,
    asU1([reg("reregister_at_limit", ep("lim3"))]),
    scalar("same_id_after_reregister", `select (id::text = current_setting('n1.id3'))::text || '/' || (select count(*) from public.push_subscriptions where user_id = '${U1}' and endpoint like '%lim3')::text from public.push_subscriptions where endpoint = '${ep("lim3")}'`),
    `update public.push_subscriptions set revoked_at = now(), revoke_reason = 'user' where endpoint = '${ep("lim1")}';`,
    asU1([reg("revived_revoked", ep("lim1"))]),
    scalar("revived_state", `select coalesce(revoked_at::text, 'none') || '/' || coalesce(revoke_reason, 'none') from public.push_subscriptions where endpoint = '${ep("lim1")}'`),
    `update public.push_subscriptions set revoked_at = now(), revoke_reason = 'user' where endpoint = '${ep("lim1")}';`,
    asU1([reg("eleventh_after_a_revoke", ep("lim11")), probe("revive_over_limit", `select ${call(ep("lim1"))}`, "P0001", "device_limit")]),
    // the limit is per person
    asU2([reg("other_person_unaffected", ep("u2a"))]),
    // re-bind: another person registers an endpoint someone else holds
    dev(D1, U1, ep("shared")),
    `insert into public.notification_deliveries (id, user_id, kind, subject_id, channel, device_id) values ('${CLAIM}', '${U1}', 'match_alert', '${SUBJECT}', 'push', '${D1}');`,
    asU2([reg("rebind", ep("shared"), { zone: "Asia/Kolkata", ua: "Firefox" })]),
    scalar("rebound_owner", `select user_id || '/' || ua_short || '/' || timezone || '/' || (id = '${D1}')::text || '/' || coalesce(revoked_at::text, 'active') from public.push_subscriptions where endpoint = '${ep("shared")}'`),
    // the previous owner's row is kept, revoked with the reason user, its endpoint and keys no longer usable (F5)
    scalar("previous_row", `select user_id || '/' || (revoked_at is not null)::text || '/' || coalesce(revoke_reason, 'none') || '/' || (endpoint <> '${ep("shared")}')::text || '/' || (p256dh <> 'k' and auth <> 'a')::text from public.push_subscriptions where id = '${D1}'`),
    scalar("new_row_is_new", `select (id <> '${D1}')::text from public.push_subscriptions where endpoint = '${ep("shared")}'`),
    scalar("one_row_per_endpoint", `select count(*) from public.push_subscriptions where endpoint = '${ep("shared")}'`),
    // the previous owner's ledger rows are left as they were: they point at the previous owner's own (now revoked) device
    scalar("ledger_untouched", `select user_id || '/' || device_id from public.notification_deliveries where id = '${CLAIM}'`),
    asU2([rowsOf("new_owner_sees_old_row", `select id from public.push_subscriptions where id = '${D1}'`), rowsOf("new_owner_sees_own", `select id from public.push_subscriptions where ua_short = 'Firefox' and revoked_at is null`)]),
    asU1([rowsOf("previous_owner_sees", `select id from public.push_subscriptions where id = '${D1}'`), rowsOf("previous_owner_deletes", `delete from public.push_subscriptions where id = '${D1}'`)]),
    scalar("meta", "select p.proisstrict::text || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'register_push_subscription'"),
    scalar("acl", "select coalesce(string_agg(coalesce(g.rolname, 'PUBLIC'), ',' order by g.rolname), 'nobody') from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee where p.pronamespace = 'public'::regnamespace and p.proname = 'register_push_subscription' and a.grantee <> p.proowner"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("only a signed-in person may call it: anon, the service role and a session with no subject are 42501 (the caller is auth.uid(), never an argument)", () => {
    for (const k of ["anon", "service_role", "no_session_subject"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.acl).toBe("authenticated");
    expect(r.res.meta).toBe(`false/true/${'{"search_path=\\"\\""}'}`);
  });
  it("at most ten active devices per person: the eleventh is P0001 device_limit; re-registering one of the ten is allowed at the limit; a revoked one does not count", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(r.res[`d${n}`], `d${n}`).toBe("id");
    expect(r.res.eleventh).toBe("ok");
    expect(r.res.reregister_at_limit).toBe("id");
    expect(r.res.same_id_after_reregister).toBe("true/1"); // the caller's own device is refreshed in place: same row, no copy
    expect(r.res.eleventh_after_a_revoke).toBe("id");
    expect(r.res.revive_over_limit, "reviving a revoked device would make eleven active").toBe("ok");
  });
  it("registering a revoked endpoint again revives it (revoked_at and the reason cleared), and another person's limit is separate", () => {
    expect(r.res.revived_revoked).toBe("id");
    expect(r.res.revived_state).toBe("none/none");
    expect(r.res.other_person_unaffected).toBe("id");
  });
  it("an endpoint someone else holds goes to the caller as a NEW row (new id, new keys, browser and zone), and the previous owner's row is kept, revoked (user), with its endpoint and keys made unusable; one live row per endpoint", () => {
    expect(r.res.rebind).toBe("id");
    expect(r.res.rebound_owner).toBe(`${U2}/Firefox/Asia/Kolkata/false/active`);
    expect(r.res.new_row_is_new).toBe("true");
    expect(r.res.one_row_per_endpoint).toBe("1");
    expect(r.res.previous_row).toBe(`${U1}/true/user/true/true`);
  });
  it("the previous owner still sees their own (revoked) row and can delete it; the new owner does not see it and sees their own", () => {
    expect([r.res.previous_owner_sees, r.res.previous_owner_deletes]).toEqual(["1", "1"]);
    expect([r.res.new_owner_sees_old_row, r.res.new_owner_sees_own]).toEqual(["0", "1"]);
  });
  it("the previous owner's ledger rows still point at the previous owner's (now revoked) device, so a take-over leaves the history intact", () => expect(r.res.ledger_untouched).toBe(`${U1}/${D1}`));
});

describe("a deletion request revokes the person's devices (N1-R11)", () => {
  const D3 = "00000000-0000-4000-8000-0000000000d3";
  const REV = (id: string) => `select coalesce(revoked_at is not null, false)::text || '/' || coalesce(revoke_reason, 'none') from public.push_subscriptions where id = '${id}'`;
  const body = [
    FIXTURES,
    dev(D1, U1, ep("a")),
    dev(D2, U1, ep("b"), "revoked_at=now() - interval '2 days'"),
    `update public.push_subscriptions set revoke_reason = 'user' where id = '${D2}';`,
    dev(D3, U2, ep("c")),
    scalar("before_d1", REV(D1)),
    rowsOf("request", `update public.profiles set deletion_requested_at = now() where id = '${U1}'`),
    scalar("d1", REV(D1)),
    scalar("d2", REV(D2)),
    scalar("d3_other_person", REV(D3)),
    scalar("d2_time_kept", `select (revoked_at = now() - interval '2 days')::text from public.push_subscriptions where id = '${D2}'`),
    // a second change of the column revokes nothing again; clearing it does not revive anything
    `update public.push_subscriptions set revoked_at = now() - interval '1 hour', revoke_reason = 'gone' where id = '${D1}';`,
    rowsOf("request_again", `update public.profiles set deletion_requested_at = now() + interval '1 day' where id = '${U1}'`),
    scalar("d1_after_second", `select revoke_reason from public.push_subscriptions where id = '${D1}'`),
    rowsOf("cancel_request", `update public.profiles set deletion_requested_at = null where id = '${U1}'`),
    scalar("d1_after_cancel", `select revoke_reason from public.push_subscriptions where id = '${D1}'`),
    // an unrelated update of the profile touches no device
    dev("00000000-0000-4000-8000-0000000000d4", U2, ep("d")),
    rowsOf("unrelated", `update public.profiles set email = 'x@example.test' where id = '${U2}'`),
    scalar("unrelated_state", REV("00000000-0000-4000-8000-0000000000d4")),
    scalar("trigger", "select string_agg(t.tgname || ':' || pg_get_triggerdef(t.oid), ' ; ') from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'notification_revoke_devices_on_deletion_request'"),
    scalar("fn_meta", "select p.prosecdef::text || '/' || coalesce(p.proconfig::text, '') || '/' || (select coalesce(string_agg(coalesce(g.rolname, 'PUBLIC'), ','), 'nobody') from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee where a.grantee <> p.proowner) from pg_proc p where p.proname = 'notification_revoke_devices_on_deletion_request'"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("setting deletion_requested_at revokes the person's active devices with the reason deleted, and nobody else's", () => {
    expect(r.res.before_d1).toBe("false/none");
    expect(r.res.d1).toBe("true/deleted");
    expect(r.res.d3_other_person).toBe("false/none");
  });
  it("a device already revoked keeps its own reason and time", () => {
    expect(r.res.d2).toBe("true/user");
    expect(r.res.d2_time_kept).toBe("true");
  });
  it("only the first request acts: a later change of the date revokes nothing again, and cancelling the request revives nothing", () => {
    expect(r.res.d1_after_second).toBe("gone");
    expect(r.res.d1_after_cancel).toBe("gone");
  });
  it("an unrelated profile update touches no device", () => expect(r.res.unrelated_state).toBe("false/none"));
  it("it is a trigger after update of deletion_requested_at, not a new RPC; the function is internal: security definer, empty search_path, executable by nobody", () => {
    expect(r.res.trigger).toMatch(/AFTER UPDATE OF deletion_requested_at ON public\.profiles FOR EACH ROW WHEN \(\(\(old\.deletion_requested_at IS NULL\) AND \(new\.deletion_requested_at IS NOT NULL\)\)\)/);
    expect(r.res.fn_meta).toBe(`true/${'{"search_path=\\"\\""}'}/nobody`);
  });
});

describe("the preference columns, the stream unsubscribe and the flags (prompt 01 sections 2.5 and 2.6)", () => {
  const FLAGS: Array<[string, string]> = [
    ["notifications_master", "Notifications: master switch"],
    ["push_sender", "Notifications: send push"],
    ["admin_messaging", "Admin messages: enabled"],
    ["admin_promotions", "Admin messages: promotions"],
    ["admin_email", "Admin messages: email"],
  ];
  const COLS = ["push_enabled", "push_new_applicant", "push_application_viewed", "push_match_alert", "push_promotions", "email_promotions", "email_announcements"];
  const EARLY = "00000000-0000-4000-8000-0000000000a7";
  const TOKEN = (u: string) => `(select unsubscribe_token from public.email_preferences where user_id = '${u}')`;
  const unsub = (token: string, stream: string, sub?: string) => `public.email_unsubscribe_stream(p_token => ${token}, p_stream => '${stream}'${sub === undefined ? "" : `, p_subscribed => ${sub}`})`;
  const body = [
    // a person who already has a preferences row when the migration runs gets the defaults
    FIXTURES,
    scalar("columns", `select string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ' ; ' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'email_preferences' and column_name = any (array['${COLS.join("', '")}'])`),
    scalar("existing_row_defaults", `select push_enabled::text || push_new_applicant::text || push_application_viewed::text || push_match_alert::text || push_promotions::text || email_promotions::text || email_announcements::text from public.email_preferences where user_id = '${EARLY}'`),
    scalar("flags", `select string_agg(key || '=' || label || '=' || enabled, ' ; ' order by key) from public.feature_flags where key in (${FLAGS.map(([k]) => `'${k}'`).join(", ")})`),
    scalar("owner_flag_kept", "select label || '=' || enabled from public.feature_flags where key = 'push_sender'"),
    asRole("service_role", [
      scalar("matched_announcements", `select matched from ${unsub(TOKEN(U1), "announcements", "false")}`),
      scalar("after_announcements", `select email_announcements::text || email_promotions::text from public.email_preferences where user_id = '${U1}'`),
      scalar("matched_promotions_true", `select matched from ${unsub(TOKEN(U1), "promotions", "true")}`),
      scalar("after_promotions", `select email_announcements::text || email_promotions::text from public.email_preferences where user_id = '${U1}'`),
      scalar("default_is_off", `select matched from ${unsub(TOKEN(U1), "promotions")}`),
      scalar("after_default", `select email_promotions::text from public.email_preferences where user_id = '${U1}'`),
      // turn the stream on first, so a null that wrongly means "subscribed" cannot hide behind a value that was already off
      scalar("on_again", `select matched from ${unsub(TOKEN(U1), "promotions", "true")}`),
      scalar("null_subscribed_is_off", `select matched from ${unsub(TOKEN(U1), "promotions", "null")}`),
      scalar("after_null_promotions", `select email_promotions::text from public.email_preferences where user_id = '${U1}'`),
      scalar("on_again_announcements", `select matched from ${unsub(TOKEN(U1), "announcements", "true")}`),
      scalar("null_subscribed_announcements", `select matched from ${unsub(TOKEN(U1), "announcements", "null")}`),
      scalar("after_null_announcements", `select email_announcements::text from public.email_preferences where user_id = '${U1}'`),
      scalar("other_person_untouched", `select email_announcements::text from public.email_preferences where user_id = '${U2}'`),
      scalar("unknown_token", `select matched from ${unsub("'no-such-token'", "announcements")}`),
      scalar("null_token", `select count(*) from ${unsub("null", "announcements")} where matched`),
      probe("unknown_stream", `select * from ${unsub(TOKEN(U1), "weekly")}`, "22023"),
      probe("null_stream", `select * from public.email_unsubscribe_stream(p_token => ${TOKEN(U1)}, p_stream => null)`, "22023"),
    ]),
    ...(["anon", "authenticated"] as const).map((role) => asRole(role, [probe(`${role}_refused`, `select * from ${unsub("'t'", "announcements")}`, "42501")], role === "authenticated" ? U1 : undefined)),
    scalar("meta", "select p.proisstrict::text || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'email_unsubscribe_stream'"),
    scalar("acl", "select coalesce(string_agg(coalesce(g.rolname, 'PUBLIC'), ',' order by g.rolname), 'nobody') from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee where p.pronamespace = 'public'::regnamespace and p.proname = 'email_unsubscribe_stream' and a.grantee <> p.proowner"),
    scalar("client_roles_on_prefs", "select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'email_preferences' and grantee in ('anon', 'authenticated', 'PUBLIC')"),
    scalar("service_role_verbs", "select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('service_role', 'public.email_preferences', p)"),
  ].join("\n");
  const r = replay0265(body, {
    prelude: "insert into auth.users (id, email, instance_id, aud, role) values ('00000000-0000-4000-8000-0000000000a7', 'early@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');\ninsert into public.feature_flags (key, label, enabled) values ('push_sender', 'owner label', true);",
  });

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("email_preferences gains exactly the seven columns: five push switches and email_promotions default false, email_announcements default true, all boolean NOT NULL", () => {
    expect(r.res.columns).toBe(
      [...COLS].sort().map((c) => `${c} boolean NO ${c === "email_announcements" ? "true" : "false"}`).join(" ; "),
    );
    expect(r.res.existing_row_defaults).toBe("falsefalsefalsefalsefalsefalsetrue");
  });
  it("the five flags exist with their plain-English labels, all off; a flag the owner already has is left as it is", () => {
    expect(r.res.flags).toBe(FLAGS.map(([k, l]) => (k === "push_sender" ? `${k}=owner label=true` : `${k}=${l}=false`)).sort().join(" ; "));
    expect(r.res.owner_flag_kept).toBe("owner label=true");
  });
  it("the unsubscribe flips the stream's column for the token's owner only, matched true; the default is off and a null value is off", () => {
    expect(r.res.matched_announcements).toBe("true");
    expect(r.res.after_announcements).toBe("falsefalse");
    expect(r.res.matched_promotions_true).toBe("true");
    expect(r.res.after_promotions).toBe("falsetrue");
    expect(r.res.default_is_off).toBe("true");
    expect(r.res.after_default).toBe("false");
    expect(r.res.null_subscribed_is_off).toBe("true");
    expect([r.res.on_again, r.res.after_null_promotions]).toEqual(["true", "false"]);
    expect([r.res.on_again_announcements, r.res.null_subscribed_announcements, r.res.after_null_announcements]).toEqual(["true", "true", "false"]);
    expect(r.res.other_person_untouched).toBe("true");
  });
  it("an unknown or null token is matched false with no error; an unknown or null stream is 22023", () => {
    expect(r.res.unknown_token).toBe("false");
    expect(r.res.null_token).toBe("0");
    expect(r.res.unknown_stream).toBe("ok");
    expect(r.res.null_stream).toBe("ok");
  });
  it("the unsubscribe is service-role only (42501 for anon and authenticated), not strict, a security definer with an empty search_path", () => {
    expect(r.res.anon_refused).toBe("ok");
    expect(r.res.authenticated_refused).toBe("ok");
    expect(r.res.acl).toBe("service_role");
    expect(r.res.meta).toBe(`false/true/${'{"search_path=\\"\\""}'}`);
  });
  it("email_preferences stays closed to client roles and service_role holds select, insert, update and delete explicitly", () => {
    expect(r.res.client_roles_on_prefs).toBe("0");
    expect(r.res.service_role_verbs).toBe("DELETE,INSERT,SELECT,UPDATE");
  });
});

describe("the five flags on a database that has none of them, and the rollback of part 3", () => {
  const KEYS = ["admin_email", "admin_messaging", "admin_promotions", "notifications_master", "push_sender"];
  const rollbackText = readRollback(R0265);
  const body = [
    FIXTURES,
    scalar("flags_fresh", `select string_agg(key || '=' || enabled, ' ; ' order by key) from public.feature_flags where key = any (array[${KEYS.map((k) => `'${k}'`).join(", ")}])`),
    // the rollback, run again after the forward file, takes part 3 away completely
    rollbackText,
    scalar("fns_after", "select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array['register_push_subscription', 'email_unsubscribe_stream', 'notification_revoke_devices_on_deletion_request', 'resolve_admin_segment', 'prepare_admin_message', 'submit_admin_message', 'approve_admin_message', 'cancel_admin_message', 'start_admin_message_send', 'admin_message_audit', 'record_admin_message_test', 'set_notification_setting', 'pause_admin_message_send', 'resume_admin_message_send', 'admin_email_eligible_recipients'])"),
    scalar("trigger_after", "select count(*) from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'notification_revoke_devices_on_deletion_request'"),
    scalar("columns_after", "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'email_preferences' and column_name = any (array['push_enabled', 'push_new_applicant', 'push_application_viewed', 'push_match_alert', 'push_promotions', 'email_promotions', 'email_announcements'])"),
    scalar("flags_after", `select count(*) from public.feature_flags where key = any (array[${KEYS.map((k) => `'${k}'`).join(", ")}])`),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a database with none of the flags gets all five, each off", () => expect(r.res.flags_fresh).toBe(KEYS.map((k) => `${k}=false`).join(" ; ")));
  it("the rollback removes the functions of parts 3 and 4 (the device, unsubscribe, revoke and the twelve admin-message functions), the trigger, the seven columns and the five flag rows", () => {
    expect([r.res.fns_after, r.res.trigger_after, r.res.columns_after, r.res.flags_after]).toEqual(["0", "0", "0", "0"]);
  });
});
