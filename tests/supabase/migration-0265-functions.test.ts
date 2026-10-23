/**
 * Migration 0265, part 2: the ledger functions (checkpoint B). Every test replays the migration file as it is on disk in a PRIVATE scratch database, in one rolled-back transaction, and calls the
 * functions in that transaction as the role under test (`set local role service_role`, with the JWT claims where a person's session matters), so a refusal is the database's own refusal.
 *
 * TIME. The functions read now(). A test never sets the clock: it seeds rows relative to the transaction's own now() (N1-R25), and it takes its time zones from the real now() (N1-R26e): one
 * whose local time is 01:00 to 04:00 (deep inside quiet hours) and one whose local time is 09:00 to 19:00 (deep outside). The predicate itself takes the instant, so ITS edges are tested with
 * fixed instants.
 *
 *   predicate      notification_in_quiet_hours: edges, zones, daylight saving, null and invalid input, not STRICT, executable by nobody
 *   claim          every refusal in the contract's order, the two push budgets, the windows, the admin email cap and ceiling, the source check
 *   the rest       release, mark sent, stale claims, resolve a stale claim, unread count
 *   prune          what goes and what stays
 *   grants         the exact function list, flags and EXECUTE per role
 *
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage); read from docker by migration-0265-local-db.ts.
 */
import { describe, expect, it } from "vitest";
import {
  A1, A2, CONFIG, D1, D2, FIXTURES, FUNCTIONS, INVOKER_ALLOWED, M1, NAMES, NAME_LIST, U1, U2, ZONES_SQL, ZONE_IN, ZONE_OUT, adminSql, asRole, claimTo, deviceZoneSql, draftSql, grantPermissionSql, probe, replay0265, scalar,
} from "./migration-0265-support";

const sub = (n: number) => `00000000-0000-4000-8000-0000000f${n.toString(16).padStart(4, "0")}`;
const D3 = "00000000-0000-4000-8000-0000000000d3";
const D4 = "00000000-0000-4000-8000-0000000000d4";
const D5 = "00000000-0000-4000-8000-0000000000d5";
const UNKNOWN = "00000000-0000-4000-8000-0000000000ee";

/** Named arguments of claim_notification. */
const args = (user: string, kind: string, subject: string, channel: string, device?: string | null, window?: string) =>
  `p_user => '${user}', p_kind => '${kind}', p_subject => '${subject}', p_channel => '${channel}'${device === undefined ? "" : device === null ? ", p_device => null" : `, p_device => '${device}'`}${window ? `, p_window => interval '${window}'` : ""}`;
const claim = (name: string, a: string) => claimTo(name, a);
const callOk = (name: string, query: string) => `select 'R|${name}|ok' from (${query}) _x;`;
const direct = (user: string, kind: string, subject: string, channel: string, device: string | null, claimedAt: string, extra = "") =>
  `insert into public.notification_deliveries (user_id, kind, subject_id, channel, device_id, claimed_at${extra ? ", " + extra.split("=")[0] : ""}) values ('${user}', '${kind}', '${subject}', '${channel}', ${device ? `'${device}'` : "null"}, ${claimedAt}${extra ? ", " + extra.split("=")[1] : ""});`;
const asService = (lines: string[]) => asRole("service_role", lines);

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* the predicate                                                                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

const EDGES: Array<[string, string, boolean]> = [
  // UTC: 21:59:59 allowed, 22:00:00 quiet, 06:59:59 quiet, 07:00:00 allowed
  ["2026-06-01 21:59:59+00", "UTC", false],
  ["2026-06-01 22:00:00+00", "UTC", true],
  ["2026-06-01 23:30:00+00", "UTC", true],
  ["2026-06-02 00:00:00+00", "UTC", true],
  ["2026-06-02 06:59:59+00", "UTC", true],
  ["2026-06-02 07:00:00+00", "UTC", false],
  ["2026-06-02 12:00:00+00", "UTC", false],
  // Africa/Lagos is UTC+1 all year
  ["2026-06-01 20:59:59+00", "Africa/Lagos", false],
  ["2026-06-01 21:00:00+00", "Africa/Lagos", true],
  ["2026-06-02 05:59:59+00", "Africa/Lagos", true],
  ["2026-06-02 06:00:00+00", "Africa/Lagos", false],
  // America/Los_Angeles: UTC-7 in June, UTC-8 in January
  ["2026-06-02 04:59:59+00", "America/Los_Angeles", false],
  ["2026-06-02 05:00:00+00", "America/Los_Angeles", true],
  ["2026-06-02 13:59:59+00", "America/Los_Angeles", true],
  ["2026-06-02 14:00:00+00", "America/Los_Angeles", false],
  ["2026-01-02 05:59:59+00", "America/Los_Angeles", false],
  ["2026-01-02 06:00:00+00", "America/Los_Angeles", true],
  // Asia/Kolkata is UTC+5:30
  ["2026-06-01 16:29:59+00", "Asia/Kolkata", false],
  ["2026-06-01 16:30:00+00", "Asia/Kolkata", true],
  ["2026-06-02 01:29:59+00", "Asia/Kolkata", true],
  ["2026-06-02 01:30:00+00", "Asia/Kolkata", false],
  // a zone far from UTC on each side
  ["2026-06-01 07:59:59+00", "Pacific/Kiritimati", false], // 21:59:59 local (UTC+14)
  ["2026-06-01 08:00:00+00", "Pacific/Kiritimati", true],
  ["2026-06-01 08:59:59+00", "Pacific/Pago_Pago", false], // 21:59:59 local (UTC-11)
  ["2026-06-01 09:00:00+00", "Pacific/Pago_Pago", true],
  // daylight saving: New York springs forward on 8 March 2026 (02:00 EST becomes 03:00 EDT) and falls back on 1 November 2026
  ["2026-03-08 01:59:59+00", "America/New_York", false], // 8 March, 20:59:59 EST the evening before... 7 March 20:59:59 local
  ["2026-03-08 03:00:00+00", "America/New_York", true], // 22:00 EST on 7 March
  ["2026-03-08 06:59:59+00", "America/New_York", true], // 01:59:59 EST, the last second before the clocks jump
  ["2026-03-08 07:00:00+00", "America/New_York", true], // 03:00:00 EDT
  ["2026-03-08 10:59:59+00", "America/New_York", true], // 06:59:59 EDT
  ["2026-03-08 11:00:00+00", "America/New_York", false], // 07:00:00 EDT
  ["2026-03-09 01:59:59+00", "America/New_York", false], // 21:59:59 EDT
  ["2026-03-09 02:00:00+00", "America/New_York", true], // 22:00:00 EDT
  ["2026-11-01 11:59:59+00", "America/New_York", true], // 06:59:59 EST, after the clocks fell back
  ["2026-11-01 12:00:00+00", "America/New_York", false], // 07:00:00 EST
  ["2026-11-02 02:59:59+00", "America/New_York", false], // 21:59:59 EST
  ["2026-11-02 03:00:00+00", "America/New_York", true], // 22:00:00 EST
];

describe("the quiet-hours predicate notification_in_quiet_hours (N1-R25, N1-R26 b and c)", () => {
  const body = [
    ZONES_SQL,
    ...EDGES.map(([t, z], i) => scalar(`edge_${i}`, `select public.notification_in_quiet_hours('${t}'::timestamptz, '${z}')`)),
    probe("null_instant", "select public.notification_in_quiet_hours(null::timestamptz, 'UTC')", "22023"),
    probe("null_zone", "select public.notification_in_quiet_hours(now(), null)", "22023"),
    probe("both_null", "select public.notification_in_quiet_hours(null::timestamptz, null)", "22023"),
    probe("invalid_zone", "select public.notification_in_quiet_hours(now(), 'Mars/Olympus')", "22023"),
    probe("empty_zone", "select public.notification_in_quiet_hours(now(), '')", "22023"),
    probe("abbreviation_only", "select public.notification_in_quiet_hours(now(), 'PST')", "22023"),
    probe("lower_case_name", "select public.notification_in_quiet_hours(now(), 'africa/lagos')", "22023"),
    scalar("meta", "select p.proisstrict::text || '/' || p.prosecdef::text || '/' || p.provolatile::text || '/' || coalesce(p.proconfig::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'notification_in_quiet_hours'"),
    scalar("acl", "select coalesce(string_agg(coalesce(g.rolname, 'PUBLIC'), ','), 'nobody') from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee where p.pronamespace = 'public'::regnamespace and p.proname = 'notification_in_quiet_hours' and a.grantee <> p.proowner"),
    scalar("overloads", "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notification_in_quiet_hours'"),
    asRole("service_role", [probe("as_service_role", "select public.notification_in_quiet_hours(now(), 'UTC')", "42501")]),
    asRole("authenticated", [probe("as_authenticated", "select public.notification_in_quiet_hours(now(), 'UTC')", "42501")], U1),
    asRole("anon", [probe("as_anon", "select public.notification_in_quiet_hours(now(), 'UTC')", "42501")]),
    // the real now(): the inside zone is quiet right now and the outside zone is not
    scalar("zone_in_is_quiet", `select public.notification_in_quiet_hours(now(), ${ZONE_IN})`),
    scalar("zone_out_is_not_quiet", `select public.notification_in_quiet_hours(now(), ${ZONE_OUT})`),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("22:00:00 is quiet and 21:59:59 is not; 06:59:59 is quiet and 07:00:00 is not, in UTC, Lagos, Los Angeles (summer and winter), Kolkata and the two farthest zones", () => {
    for (let i = 0; i < EDGES.length; i++) {
      const [t, z, want] = EDGES[i];
      expect(r.res[`edge_${i}`], `${t} in ${z}`).toBe(String(want));
    }
  });
  it("a daylight-saving change day is read in the zone's own local time (New York, spring and fall)", () => {
    const dst = EDGES.map((e, i) => [e, i] as const).filter(([e]) => e[1] === "America/New_York");
    expect(dst.length).toBeGreaterThanOrEqual(10);
    for (const [e, i] of dst) expect(r.res[`edge_${i}`], e[0]).toBe(String(e[2]));
  });
  it("a null instant, a null zone, both null, an unknown zone, an empty zone, an abbreviation that is not a zone name, or a lower-case name raise 22023 (the predicate fails closed)", () => {
    for (const k of ["null_instant", "null_zone", "both_null", "invalid_zone", "empty_zone", "abbreviation_only", "lower_case_name"]) expect(r.res[k], k).toBe("ok");
  });
  it("it is NOT strict (a strict function would return null for a null argument), not a security definer, stable, with an empty search_path; one function, no overloads (N1-R26b)", () => {
    expect(r.res.meta).toBe(`false/false/s/${CONFIG}`);
    expect(r.res.overloads).toBe("1");
  });
  it("it is executable by nobody: not PUBLIC, anon, authenticated or service_role (42501 each)", () => {
    expect(r.res.acl).toBe("nobody");
    for (const k of ["as_service_role", "as_authenticated", "as_anon"]) expect(r.res[k], k).toBe("ok");
  });
  it("relative to the real now(): a zone whose local time is 01:00 to 04:00 is quiet, and one whose local time is 09:00 to 19:00 is not (N1-R26e)", () => {
    expect(r.res.zone_in_is_quiet).toBe("true");
    expect(r.res.zone_out_is_not_quiet).toBe("false");
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* claim_notification                                                                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

describe("claim_notification: in-app and email claims, arguments, one row (contract note 2)", () => {
  const body = [
    FIXTURES,
    asService([
      claim("inapp_first", args(U1, "match_alert", sub(1), "inapp")),
      claim("inapp_again", args(U1, "match_alert", sub(1), "inapp")),
      claim("inapp_other_kind", args(U1, "new_applicant", sub(1), "inapp")),
      claim("inapp_other_subject", args(U1, "match_alert", sub(2), "inapp")),
      claim("inapp_other_user", args(U2, "match_alert", sub(1), "inapp")),
      claim("email_first", args(U1, "match_alert", sub(1), "email")),
      claim("email_again", args(U1, "match_alert", sub(1), "email")),
      claim("admin_email_ok", args(U1, "admin_message", sub(9), "email")),
      probe("bad_kind", `select * from public.claim_notification(${args(U1, "bogus", sub(1), "inapp")})`, "22023"),
      probe("bad_channel", `select * from public.claim_notification(${args(U1, "match_alert", sub(1), "sms")})`, "22023"),
      probe("null_user", "select * from public.claim_notification(p_user => null, p_kind => 'match_alert', p_subject => gen_random_uuid(), p_channel => 'inapp')", "22023"),
      probe("null_subject", `select * from public.claim_notification(p_user => '${U1}', p_kind => 'match_alert', p_subject => null, p_channel => 'inapp')`, "22023"),
      probe("null_kind", `select * from public.claim_notification(p_user => '${U1}', p_kind => null, p_subject => gen_random_uuid(), p_channel => 'inapp')`, "22023"),
      probe("null_channel", `select * from public.claim_notification(p_user => '${U1}', p_kind => 'match_alert', p_subject => gen_random_uuid(), p_channel => null)`, "22023"),
      probe("negative_window", `select * from public.claim_notification(${args(U1, "match_alert", sub(3), "inapp", undefined, "-1 hour")})`, "22023"),
      probe("null_window", `select * from public.claim_notification(p_user => '${U1}', p_kind => 'match_alert', p_subject => gen_random_uuid(), p_channel => 'inapp', p_window => null)`, "22023"),
      scalar("rows_per_claim", `select count(*) from public.notification_deliveries where user_id = '${U1}' and subject_id = '${sub(1)}' and kind = 'match_alert'`),
      scalar("shape", "select count(*) from (select * from public.claim_notification(p_user => '" + U1 + "', p_kind => 'match_alert', p_subject => gen_random_uuid(), p_channel => 'inapp') c where (c.id is null) = (c.refused is null)) x"),
    ]),
    // a released in-app claim can be claimed again
    callOk("release_inapp", `select public.release_notification(p_id => (select d.id from public.notification_deliveries d where d.user_id = '${U1}' and d.kind = 'new_applicant' and d.subject_id = '${sub(1)}' and d.channel = 'inapp'), p_reason => 'pre_send_failure')`),
    asService([claim("inapp_after_release", args(U1, "new_applicant", sub(1), "inapp"))]),
    scalar("meta", "select p.proisstrict::text || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'claim_notification'"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the first claim returns an id; the same claim twice returns one row and the second says already_claimed", () => {
    expect(r.res.inapp_first).toBe("id/-");
    expect(r.res.inapp_again).toBe("null/already_claimed");
    expect(r.res.rows_per_claim).toBe("2");
  });
  it("another kind, subject, person or channel is a different claim", () => {
    for (const k of ["inapp_other_kind", "inapp_other_subject", "inapp_other_user", "email_first"]) expect(r.res[k], k).toBe("id/-");
    expect(r.res.email_again).toBe("null/already_claimed");
  });
  it("an e-mail claim of an admin message with no cap in play (the default 50) succeeds", () => expect(r.res.admin_email_ok).toBe("id/-"));
  it("an unknown kind or channel, a null argument or a negative or null window raises 22023 and never answers as a refusal", () => {
    for (const k of ["bad_kind", "bad_channel", "null_user", "null_subject", "null_kind", "null_channel", "negative_window", "null_window"]) expect(r.res[k], k).toBe("ok");
  });
  it("every answer is ONE row with exactly one of id and refused set", () => expect(r.res.shape).toBe("0"));
  it("a released claim can be claimed again", () => expect(r.res.inapp_after_release).toBe("id/-"));
  it("it is not strict, is a security definer with an empty search_path", () => expect(r.res.meta).toBe(`false/true/${CONFIG}`));
});

describe("claim_notification: a non-push claim ignores p_device and stores NULL (N1-R29 Q5)", () => {
  const OTHER = "00000000-0000-4000-8000-0000000000ef";
  const body = [
    FIXTURES,
    ZONES_SQL,
    deviceZoneSql(D1, U1, ZONE_OUT),
    asService([
      claim("email_device_a", args(U1, "match_alert", sub(40), "email", UNKNOWN)),
      claim("email_device_b", args(U1, "match_alert", sub(40), "email", OTHER)),
      claim("email_real_device", args(U1, "match_alert", sub(40), "email", D1)),
      claim("inapp_device_a", args(U1, "match_alert", sub(41), "inapp", UNKNOWN)),
      claim("inapp_device_b", args(U1, "match_alert", sub(41), "inapp", OTHER)),
      claim("email_no_device", args(U1, "match_alert", sub(40), "email")),
      claim("push_keeps_device", args(U1, "match_alert", sub(42), "push", D1)),
    ]),
    scalar("non_push_with_device", `select count(*) from public.notification_deliveries where channel <> 'push' and device_id is not null`),
    scalar("push_device", `select count(*) from public.notification_deliveries where channel = 'push' and device_id = '${D1}'`),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies (a made-up device id on an e-mail or in-app claim is not a foreign-key error)", () => expect(r.ok, r.stderr).toBe(true));
  it("two e-mail claims for one event with different device ids: the first succeeds, the second is already_claimed; so is a third with a real device and one with none", () => {
    expect(r.res.email_device_a).toBe("id/-");
    for (const k of ["email_device_b", "email_real_device", "email_no_device"]) expect(r.res[k], k).toBe("null/already_claimed");
  });
  it("the same holds for in-app claims", () => {
    expect(r.res.inapp_device_a).toBe("id/-");
    expect(r.res.inapp_device_b).toBe("null/already_claimed");
  });
  it("no non-push claim stores a device; a push claim still stores its device", () => {
    expect(r.res.non_push_with_device).toBe("0");
    expect(r.res.push_device).toBe("1");
  });
});

describe("claim_notification: push, availability, quiet hours and the order of refusals", () => {
  const body = [
    FIXTURES,
    ZONES_SQL,
    deviceZoneSql(D1, U1, ZONE_OUT),
    deviceZoneSql(D2, U1, ZONE_IN),
    deviceZoneSql(D3, U2, ZONE_OUT),
    deviceZoneSql(D4, U1, ZONE_IN, "revoked_at=now()"),
    asService([
      claim("missing_device", args(U1, "match_alert", sub(1), "push", UNKNOWN)),
      claim("null_device", args(U1, "match_alert", sub(1), "push", null)),
      claim("no_device_argument", args(U1, "match_alert", sub(1), "push")),
      claim("someone_elses_device", args(U1, "match_alert", sub(1), "push", D3)),
      claim("revoked_device_in_quiet_zone", args(U1, "match_alert", sub(1), "push", D4)),
      claim("quiet_device", args(U1, "match_alert", sub(1), "push", D2)),
      claim("open_device", args(U1, "match_alert", sub(1), "push", D1)),
      claim("open_device_again", args(U1, "match_alert", sub(1), "push", D1)),
      // two devices in different zones: the event reaches only the one outside quiet hours and counts once toward the cap
      claim("two_zones_quiet", args(U1, "match_alert", sub(2), "push", D2)),
      claim("two_zones_open", args(U1, "match_alert", sub(2), "push", D1)),
    ]),
    scalar("events_counted", `select count(distinct (kind, subject_id)) from public.notification_deliveries where user_id = '${U1}' and channel = 'push' and released_at is null`),
    // pair 2-3: a quiet device whose person is at the cap still answers quiet_hours
    asService([claim("third_event", args(U1, "match_alert", sub(3), "push", D1)), claim("fourth_event_open", args(U1, "match_alert", sub(4), "push", D1)), claim("quiet_at_cap", args(U1, "match_alert", sub(4), "push", D2))]),
    // pair 3-6: over the cap AND already claimed answers budget_cap
    direct(U1, "match_alert", sub(5), "push", D1, "now()"),
    asService([claim("cap_before_already_claimed", args(U1, "match_alert", sub(1), "push", D1))]),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a missing, null, absent, someone else's or revoked device is device_unavailable", () => {
    for (const k of ["missing_device", "null_device", "no_device_argument", "someone_elses_device"]) expect(r.res[k], k).toBe("null/device_unavailable");
  });
  it("pair 1-2: a revoked device in a quiet zone answers device_unavailable, not quiet_hours", () => expect(r.res.revoked_device_in_quiet_zone).toBe("null/device_unavailable"));
  it("a device whose own zone is quiet right now is refused with quiet_hours, one whose zone is not quiet is allowed (relative to the real now(), N1-R26e)", () => {
    expect(r.res.quiet_device).toBe("null/quiet_hours");
    expect(r.res.open_device).toBe("id/-");
    expect(r.res.open_device_again).toBe("null/already_claimed");
  });
  it("the zone is read from the stored device, never from the caller; with two devices in different zones the event reaches only the open one and counts once", () => {
    expect(r.res.two_zones_quiet).toBe("null/quiet_hours");
    expect(r.res.two_zones_open).toBe("id/-");
    expect(r.res.events_counted).toBe("2");
  });
  it("pair 2-3: at the cap, a quiet device still answers quiet_hours", () => {
    expect(r.res.third_event).toBe("id/-");
    expect(r.res.fourth_event_open).toBe("null/budget_cap");
    expect(r.res.quiet_at_cap).toBe("null/quiet_hours");
  });
  it("pair 3-6: over the cap and already claimed answers budget_cap", () => expect(r.res.cap_before_already_claimed).toBe("null/budget_cap"));
});

describe("claim_notification: the two push budgets", () => {
  const body = [
    FIXTURES,
    ZONES_SQL,
    deviceZoneSql(D1, U1, ZONE_OUT),
    deviceZoneSql(D5, U1, ZONE_OUT),
    deviceZoneSql(D3, U2, ZONE_OUT),
    asService([
      claim("u1_e1", args(U1, "match_alert", sub(1), "push", D1)),
      claim("u1_e2", args(U1, "new_applicant", sub(2), "push", D1)),
      claim("u1_e3", args(U1, "application_viewed", sub(3), "push", D1)),
      claim("u1_e4_refused", args(U1, "match_alert", sub(4), "push", D1)),
      claim("u1_second_device_at_cap", args(U1, "match_alert", sub(1), "push", D5)),
      claim("u1_e4_other_device_refused", args(U1, "match_alert", sub(4), "push", D5)),
      claim("u1_viewed_twice", args(U1, "application_viewed", sub(3), "push", D1)),
      // after three user-event pushes an admin push is still allowed, a second one is not
      claim("u1_admin_1", args(U1, "admin_message", sub(7), "push", D1)),
      claim("u1_admin_2_refused", args(U1, "admin_message", sub(8), "push", D1)),
      // after an admin push a new-applicant push is still allowed up to three
      claim("u2_admin_1", args(U2, "admin_message", sub(7), "push", D3)),
      claim("u2_e1", args(U2, "new_applicant", sub(1), "push", D3)),
      claim("u2_e2", args(U2, "new_applicant", sub(2), "push", D3)),
      claim("u2_e3", args(U2, "new_applicant", sub(3), "push", D3)),
      claim("u2_e4_refused", args(U2, "new_applicant", sub(4), "push", D3)),
    ]),
    // a released claim does not count: release both rows of event 1 and the fourth event fits
    callOk("release_d1", `select public.release_notification(p_id => (select d.id from public.notification_deliveries d where d.user_id = '${U1}' and d.subject_id = '${sub(1)}' and d.device_id = '${D1}'), p_reason => 'gone')`),
    callOk("release_d5", `select public.release_notification(p_id => (select d.id from public.notification_deliveries d where d.user_id = '${U1}' and d.subject_id = '${sub(1)}' and d.device_id = '${D5}'), p_reason => 'gone')`),
    asService([claim("u1_e4_after_release", args(U1, "match_alert", sub(4), "push", D1))]),
    // in-app and email claims never touch the budget
    asService([claim("inapp_not_capped", args(U1, "match_alert", sub(20), "inapp")), claim("email_not_capped", args(U1, "match_alert", sub(21), "email"))]),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the user-event budget is three distinct events: the fourth is budget_cap, on any device", () => {
    for (const k of ["u1_e1", "u1_e2", "u1_e3"]) expect(r.res[k], k).toBe("id/-");
    expect(r.res.u1_e4_refused).toBe("null/budget_cap");
    expect(r.res.u1_e4_other_device_refused).toBe("null/budget_cap");
  });
  it("a second device for an event already counted is allowed at the cap and counts once", () => {
    expect(r.res.u1_second_device_at_cap).toBe("id/-");
  });
  it("application_viewed is claimed once per application and device", () => expect(r.res.u1_viewed_twice).toBe("null/already_claimed"));
  it("the admin budget is one event and is independent of the user-event budget, in both directions", () => {
    expect(r.res.u1_admin_1).toBe("id/-");
    expect(r.res.u1_admin_2_refused).toBe("null/budget_cap");
    expect(r.res.u2_admin_1).toBe("id/-");
    for (const k of ["u2_e1", "u2_e2", "u2_e3"]) expect(r.res[k], k).toBe("id/-");
    expect(r.res.u2_e4_refused).toBe("null/budget_cap");
  });
  it("a released claim does not count toward the budget", () => expect(r.res.u1_e4_after_release).toBe("id/-"));
  it("in-app and e-mail claims skip the budget", () => {
    expect(r.res.inapp_not_capped).toBe("id/-");
    expect(r.res.email_not_capped).toBe("id/-");
  });
});

describe("claim_notification: the windows are strict and relative to now() (N1-R19, N1-R21, N1-R25)", () => {
  const four = (user: string, device: string, at: string) => [1, 2, 3].map((n) => direct(user, "match_alert", sub(100 + n), "push", device, at)).join("\n");
  const body = [
    FIXTURES,
    ZONES_SQL,
    deviceZoneSql(D1, U1, ZONE_OUT),
    deviceZoneSql(D3, U2, ZONE_OUT),
    // U1: three events claimed EXACTLY one window ago do not count; U2: three claimed one second inside the window do
    four(U1, D1, "now() - interval '24 hours'"),
    four(U2, D3, "now() - interval '24 hours' + interval '1 second'"),
    asService([
      claim("exactly_a_window_old_not_counted", args(U1, "match_alert", sub(1), "push", D1)),
      claim("a_second_newer_counts", args(U2, "match_alert", sub(1), "push", D3)),
      // an explicit short window
      claim("short_window_old_rows_ignored", args(U2, "match_alert", sub(2), "push", D3, "1 hour")),
    ]),
    // a zero window: nothing counts, so even five prior events do not stop a claim (mirrors the N2 fake)
    direct(U1, "new_applicant", sub(201), "push", D1, "now() - interval '1 second'"),
    direct(U1, "new_applicant", sub(202), "push", D1, "now() - interval '1 second'"),
    direct(U1, "new_applicant", sub(203), "push", D1, "now() - interval '1 second'"),
    asService([claim("zero_window_never_refuses", args(U1, "match_alert", sub(300), "push", D1, "0 seconds"))]),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a claim exactly as old as the window no longer counts; one a second newer does", () => {
    expect(r.res.exactly_a_window_old_not_counted).toBe("id/-");
    expect(r.res.a_second_newer_counts).toBe("null/budget_cap");
  });
  it("an explicit shorter window ignores claims older than it", () => expect(r.res.short_window_old_rows_ignored).toBe("id/-"));
  it("with a window of zero seconds no earlier claim counts (N1-R21: what the N2 fake does)", () => expect(r.res.zero_window_never_refuses).toBe("id/-"));
});

describe("claim_notification: the admin e-mail cap and the monthly ceiling (N1-R17)", () => {
  const setting = (key: string, v: number) => `update public.notification_settings set int_value = ${v} where key = '${key}';`;
  const em = (name: string, n: number, kind = "admin_message") => claim(name, args(U1, kind, sub(n), "email"));
  const MONTH = "(date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')";
  const body = [
    FIXTURES,
    // --- the rolling cap, ceiling out of the way
    setting("mass_email_cap_24h", 2),
    setting("mass_email_ceiling_month", 1000),
    asService([em("cap_1", 1), em("cap_2", 2), em("cap_3_refused", 3)]),
    // raising the cap lets the next claim succeed
    setting("mass_email_cap_24h", 3),
    asService([em("cap_3_after_raise", 3), em("cap_4_refused", 4)]),
    // a missing cap row means cap 0 (fail closed)
    `delete from public.notification_settings where key = 'mass_email_cap_24h';`,
    asService([em("missing_cap_row", 5)]),
    `insert into public.notification_settings (key, int_value) values ('mass_email_cap_24h', 2);`,
    // only admin-message e-mail counts: other kinds and the push channel never do
    asService([claim("other_kind_email_uncapped", args(U1, "match_alert", sub(6), "email")), claim("admin_inapp_uncapped", args(U1, "admin_message", sub(7), "inapp"))]),
    // --- the ceiling, cap out of the way (fresh settings, fresh subjects)
    `delete from public.notification_deliveries;`,
    setting("mass_email_cap_24h", 1000),
    setting("mass_email_ceiling_month", 2),
    asService([em("ceil_1", 11), em("ceil_2", 12), em("ceil_3_refused", 13)]),
    // pair 5-6: at the ceiling an already-claimed subject answers ceiling_month
    asService([em("ceiling_before_already_claimed", 11)]),
    `delete from public.notification_settings where key = 'mass_email_ceiling_month';`,
    asService([em("missing_ceiling_row", 14)]),
    `insert into public.notification_settings (key, int_value) values ('mass_email_ceiling_month', 2);`,
    // pair 4-5: both limits reached answers cap_24h
    setting("mass_email_cap_24h", 2),
    asService([em("both_limits", 15)]),
    // --- windows relative to now()
    `delete from public.notification_deliveries;`,
    setting("mass_email_cap_24h", 2),
    setting("mass_email_ceiling_month", 1000),
    direct(U1, "admin_message", sub(31), "email", null, "now() - interval '24 hours'"),
    direct(U1, "admin_message", sub(32), "email", null, "now() - interval '24 hours'"),
    asService([em("exactly_a_day_old_not_counted", 33)]),
    `delete from public.notification_deliveries;`,
    direct(U1, "admin_message", sub(41), "email", null, "now() - interval '24 hours' + interval '1 second'"),
    direct(U1, "admin_message", sub(42), "email", null, "now() - interval '24 hours' + interval '1 second'"),
    asService([em("a_second_newer_counts", 43)]),
    // a released claim does not count
    `update public.notification_deliveries set released_at = now();`,
    asService([em("released_not_counted", 44)]),
    // --- the month: rows before the first instant of the UTC month do not count toward the ceiling, rows at it do
    `delete from public.notification_deliveries;`,
    setting("mass_email_cap_24h", 1000),
    setting("mass_email_ceiling_month", 2),
    direct(U1, "admin_message", sub(51), "email", null, `${MONTH} - interval '1 second'`),
    direct(U1, "admin_message", sub(52), "email", null, `${MONTH} - interval '1 second'`),
    asService([em("last_month_not_counted", 53)]),
    `delete from public.notification_deliveries;`,
    direct(U1, "admin_message", sub(61), "email", null, MONTH),
    direct(U1, "admin_message", sub(62), "email", null, MONTH),
    asService([em("first_instant_of_month_counts", 63)]),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the rolling cap: the claim after the cap returns cap_24h and inserts nothing; raising the cap lets the next one succeed", () => {
    expect([r.res.cap_1, r.res.cap_2]).toEqual(["id/-", "id/-"]);
    expect(r.res.cap_3_refused).toBe("null/cap_24h");
    expect(r.res.cap_3_after_raise).toBe("id/-");
    expect(r.res.cap_4_refused).toBe("null/cap_24h");
  });
  it("a missing cap row means cap 0 and a missing ceiling row means ceiling 0 (fail closed)", () => {
    expect(r.res.missing_cap_row).toBe("null/cap_24h");
    expect(r.res.missing_ceiling_row).toBe("null/ceiling_month");
  });
  it("the cap counts only e-mail claims of admin messages", () => {
    expect(r.res.other_kind_email_uncapped).toBe("id/-");
    expect(r.res.admin_inapp_uncapped).toBe("id/-");
  });
  it("the ceiling answers ceiling_month; pair 5-6 (ceiling before already_claimed) and pair 4-5 (cap before ceiling) hold", () => {
    expect([r.res.ceil_1, r.res.ceil_2]).toEqual(["id/-", "id/-"]);
    expect(r.res.ceil_3_refused).toBe("null/ceiling_month");
    expect(r.res.ceiling_before_already_claimed).toBe("null/ceiling_month");
    expect(r.res.both_limits).toBe("null/cap_24h");
  });
  it("the 24 hours are rolling and strict: a claim exactly 24 hours old no longer counts, one a second newer does, a released one never does", () => {
    expect(r.res.exactly_a_day_old_not_counted).toBe("id/-");
    expect(r.res.a_second_newer_counts).toBe("null/cap_24h");
    expect(r.res.released_not_counted).toBe("id/-");
  });
  it("the month is the UTC calendar month: a claim one second before its first instant does not count toward the ceiling, one at the first instant does", () => {
    expect(r.res.last_month_not_counted).toBe("id/-");
    expect(r.res.first_instant_of_month_counts).toBe("null/ceiling_month");
  });
});

describe("claim_notification: the source check (N1-R25 part 3, N1-R26 c)", () => {
  // The same literals the predicate owns must not be written again in the claim function. Word boundaries, so that the errcode 22023 does not trigger it.
  const TOKENS: Array<[string, RegExp]> = [
    ["22", /\b22\b/],
    ["7", /\b7\b/],
    ["'22:00'", /22:00/],
    ["'07:00'", /07:00/],
  ];
  const literalsIn = (src: string) => TOKENS.filter(([, re]) => re.test(src)).map(([name]) => name);
  const body = [
    scalar("claim_src", "select replace(encode(convert_to(p.prosrc, 'UTF8'), 'base64'), E'\\n', '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'claim_notification'"),
    scalar("predicate_src", "select replace(encode(convert_to(p.prosrc, 'UTF8'), 'base64'), E'\\n', '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'notification_in_quiet_hours'"),
  ].join("\n");
  const r = replay0265(body);
  const decode = (b64: string | undefined) => Buffer.from(b64 ?? "", "base64").toString("utf8");

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("control: the check finds a literal 22, a literal 7 and both clock strings, and is not set off by the errcode 22023 or by P0001", () => {
    expect(literalsIn("where h >= 22 or h < 7")).toEqual(["22", "7"]);
    expect(literalsIn("t >= time '22:00' or t < time '07:00'")).toEqual(expect.arrayContaining(["'22:00'", "'07:00'"]));
    expect(literalsIn("raise exception 'x' using errcode = '22023'")).toEqual([]);
    expect(literalsIn("raise exception 'x' using errcode = 'P0001', hint = 'invalid_state'")).toEqual([]);
  });
  it("the claim function calls the predicate and holds none of the four literals; the predicate owns them", () => {
    const claimSrc = decode(r.res.claim_src);
    expect(claimSrc.length).toBeGreaterThan(200);
    expect(claimSrc).toMatch(/\bnotification_in_quiet_hours\b/);
    expect(literalsIn(claimSrc)).toEqual([]);
    expect(literalsIn(decode(r.res.predicate_src)).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* the relative-now integration test through the contract path                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

describe("N1-R26 e: the contract path reads the device's zone against the real now()", () => {
  const body = [
    FIXTURES,
    ZONES_SQL,
    deviceZoneSql(D1, U1, ZONE_OUT),
    deviceZoneSql(D2, U1, ZONE_IN),
    scalar("zone_in_local", `select (now() at time zone ${ZONE_IN})::time::text`),
    scalar("zone_out_local", `select (now() at time zone ${ZONE_OUT})::time::text`),
    asService([claim("inside_zone_device", args(U1, "new_applicant", sub(1), "push", D2)), claim("outside_zone_device", args(U1, "new_applicant", sub(1), "push", D1))]),
  ].join("\n");
  const r = replay0265(body);
  const hour = (t: string | undefined) => Number((t ?? "99").slice(0, 2));

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the zones are what they claim to be: local time 01:00 to 04:00 for the inside zone, 09:00 to 19:00 for the outside zone", () => {
    expect(hour(r.res.zone_in_local)).toBeGreaterThanOrEqual(1);
    expect(hour(r.res.zone_in_local)).toBeLessThan(5);
    expect(hour(r.res.zone_out_local)).toBeGreaterThanOrEqual(9);
    expect(hour(r.res.zone_out_local)).toBeLessThan(20);
  });
  it("a push claim on the inside-zone device is quiet_hours and on the outside-zone device it succeeds", () => {
    expect(r.res.inside_zone_device).toBe("null/quiet_hours");
    expect(r.res.outside_zone_device).toBe("id/-");
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* release, mark sent, stale claims, resolving a stale claim, unread count                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

describe("release_notification and mark_notification_sent (N1-R3, N1-R4)", () => {
  const id = (kind: string, subject: number, channel: string) => `(select d.id from public.notification_deliveries d where d.user_id = '${U1}' and d.kind = '${kind}' and d.subject_id = '${sub(subject)}' and d.channel = '${channel}')`;
  const REASONS = ["gone", "rejected_413", "retries_exhausted", "our_key", "pre_send_failure"];
  const body = [
    FIXTURES,
    ZONES_SQL,
    deviceZoneSql(D1, U1, ZONE_OUT),
    asService([
      ...REASONS.map((_, i) => claim(`push_${i}`, args(U1, "admin_message", sub(10 + i), "push", D1, "0 seconds"))),
      claim("email_claim", args(U1, "match_alert", sub(30), "email")),
      claim("inapp_claim", args(U1, "match_alert", sub(31), "inapp")),
    ]),
    asService([
      ...REASONS.map((reason, i) => callOk(`release_${reason}`, `select public.release_notification(p_id => ${id("admin_message", 10 + i, "push")}, p_reason => '${reason}')`)),
      probe("release_unknown", `select public.release_notification(p_id => '${UNKNOWN}', p_reason => 'gone')`, "P0001", "unknown_id"),
      probe("release_null_id", "select public.release_notification(p_id => null, p_reason => 'gone')", "P0001", "unknown_id"),
      probe("release_email", `select public.release_notification(p_id => ${id("match_alert", 30, "email")}, p_reason => 'gone')`, "42501", "email_release_refused"),
      probe("release_email_bad_reason", `select public.release_notification(p_id => ${id("match_alert", 30, "email")}, p_reason => 'because')`, "42501", "email_release_refused"),
      probe("release_unknown_bad_reason", `select public.release_notification(p_id => '${UNKNOWN}', p_reason => 'because')`, "P0001", "unknown_id"),
      probe("release_bad_reason", `select public.release_notification(p_id => ${id("match_alert", 31, "inapp")}, p_reason => 'because')`, "22023", "invalid_release_reason"),
      probe("release_null_reason", `select public.release_notification(p_id => ${id("match_alert", 31, "inapp")}, p_reason => null)`, "22023", "invalid_release_reason"),
      callOk("release_inapp", `select public.release_notification(p_id => ${id("match_alert", 31, "inapp")}, p_reason => 'pre_send_failure')`),
      probe("mark_unknown", `select public.mark_notification_sent(p_id => '${UNKNOWN}')`, "P0001", "not_found"),
      probe("mark_null", "select public.mark_notification_sent(p_id => null)", "P0001", "not_found"),
    ]),
    scalar("released_all", `select count(*) from public.notification_deliveries where kind = 'admin_message' and channel = 'push' and released_at is not null`),
    scalar("email_untouched", `select (released_at is null)::text from public.notification_deliveries where id = ${id("match_alert", 30, "email")}`),
    // releasing twice keeps the first time; marking twice keeps the first time
    `update public.notification_deliveries set released_at = now() - interval '5 minutes' where id = ${id("match_alert", 31, "inapp")};`,
    asService([callOk("release_again", `select public.release_notification(p_id => ${id("match_alert", 31, "inapp")}, p_reason => 'gone')`)]),
    scalar("first_release_kept", `select (released_at = now() - interval '5 minutes')::text from public.notification_deliveries where id = ${id("match_alert", 31, "inapp")}`),
    asService([callOk("mark_1", `select public.mark_notification_sent(p_id => ${id("match_alert", 30, "email")})`)]),
    scalar("marked", `select (sent_at is not null)::text from public.notification_deliveries where id = ${id("match_alert", 30, "email")}`),
    `update public.notification_deliveries set sent_at = now() - interval '5 minutes' where id = ${id("match_alert", 30, "email")};`,
    asService([callOk("mark_again", `select public.mark_notification_sent(p_id => ${id("match_alert", 30, "email")})`)]),
    scalar("first_mark_kept", `select (sent_at = now() - interval '5 minutes')::text from public.notification_deliveries where id = ${id("match_alert", 30, "email")}`),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a push claim is released for each of the five reasons of the closed list", () => {
    for (const reason of REASONS) expect(r.res[`release_${reason}`], reason).toBe("ok");
    expect(r.res.released_all).toBe("5");
  });
  it("an unknown or null id is P0001 with the hint unknown_id, and that check comes first", () => {
    expect(r.res.release_unknown).toBe("ok");
    expect(r.res.release_null_id).toBe("ok");
    expect(r.res.release_unknown_bad_reason).toBe("ok");
  });
  it("releasing an e-mail claim is 42501 with the hint email_release_refused (even with a bad reason) and leaves it open", () => {
    expect(r.res.release_email).toBe("ok");
    expect(r.res.release_email_bad_reason).toBe("ok");
    expect(r.res.email_untouched).toBe("true");
  });
  it("a reason outside the closed list, or null, is 22023 with the hint invalid_release_reason; an in-app claim can be released", () => {
    expect(r.res.release_bad_reason).toBe("ok");
    expect(r.res.release_null_reason).toBe("ok");
    expect(r.res.release_inapp).toBe("ok");
  });
  it("releasing a released claim again keeps the first release time", () => {
    expect(r.res.release_again).toBe("ok");
    expect(r.res.first_release_kept).toBe("true");
  });
  it("mark_notification_sent stamps sent_at once; an unknown or null id is P0001 not_found", () => {
    expect(r.res.mark_1).toBe("ok");
    expect(r.res.marked).toBe("true");
    expect(r.res.mark_again).toBe("ok");
    expect(r.res.first_mark_kept).toBe("true");
    expect(r.res.mark_unknown).toBe("ok");
    expect(r.res.mark_null).toBe("ok");
  });
});

describe("stale_notification_claims, resolve_stale_claim and the e-mail at-most-once policy (prompt 01 section 2.3)", () => {
  const rid = (n: number) => `(select d.id from public.notification_deliveries d where d.user_id = '${U1}' and d.subject_id = '${sub(n)}' and d.channel = 'email')`;
  const body = [
    FIXTURES,
    grantPermissionSql(A1),
    adminSql("00000000-0000-4000-8000-0000000000b9", "nopermission@example.test"),
    draftSql(M1),
    direct(U1, "admin_message", M1, "email", null, "now() - interval '2 hours'"),
    direct(U1, "match_alert", sub(2), "email", null, "now() - interval '2 hours'"),
    direct(U1, "match_alert", sub(3), "email", null, "now() - interval '2 hours'"),
    direct(U1, "match_alert", sub(4), "email", null, "now() - interval '90 minutes'"),
    direct(U1, "match_alert", sub(5), "email", null, "now() - interval '30 minutes'"),
    direct(U1, "match_alert", sub(6), "inapp", null, "now() - interval '2 hours'"),
    // sub(3) is already sent; sub(5) is too young
    `update public.notification_deliveries set sent_at = now() where subject_id = '${sub(3)}';`,
    asService([
      scalar("stale_email_count", "select count(*) from public.stale_notification_claims(p_channel => 'email', p_older_than => interval '1 hour')"),
      scalar("stale_email_ids", "select string_agg(c.kind || ':' || c.channel, ',' order by c.kind) from public.stale_notification_claims(p_channel => 'email', p_older_than => interval '1 hour') c"),
      scalar("stale_inapp_count", "select count(*) from public.stale_notification_claims(p_channel => 'inapp', p_older_than => interval '1 hour')"),
      scalar("stale_none_other_channel", "select count(*) from public.stale_notification_claims(p_channel => 'push', p_older_than => interval '1 hour')"),
      probe("stale_negative", "select * from public.stale_notification_claims(p_channel => 'email', p_older_than => interval '-1 hour')", "22023"),
    ]),
    // the age is strict: a claim exactly as old as the limit is not stale
    direct(U1, "match_alert", sub(7), "email", null, "now() - interval '3 hours'"),
    asService([scalar("exactly_as_old_not_stale", "select count(*) from public.stale_notification_claims(p_channel => 'email', p_older_than => interval '3 hours')")]),
    // a retry does not re-send: the open claim stays, and the claim function says already_claimed
    asService([claim("retry_after_crash", args(U1, "match_alert", sub(2), "email"))]),
    // no automatic path releases it: release refuses, prune never touches an email row
    asService([probe("auto_release_refused", `select public.release_notification(p_id => ${rid(2)}, p_reason => 'gone')`, "42501", "email_release_refused"), scalar("pruned", "select public.prune_notification_deliveries(p_older_than_days => 1)")]),
    scalar("email_still_open", `select (released_at is null and sent_at is null)::text from public.notification_deliveries where id = ${rid(2)}`),
    // resolving needs the permission
    asService([
      probe("resolve_no_permission", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => '00000000-0000-4000-8000-0000000000b9', p_resolution => 'mark_sent')`, "42501"),
      probe("resolve_null_actor", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => null, p_resolution => 'mark_sent')`, "42501"),
      probe("resolve_unknown_actor", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => '${UNKNOWN}', p_resolution => 'mark_sent')`, "42501"),
      probe("resolve_unknown_claim", `select public.resolve_stale_claim(p_id => '${UNKNOWN}', p_actor => '${A1}', p_resolution => 'mark_sent')`, "P0001", "not_found"),
      probe("resolve_bad_resolution", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => '${A1}', p_resolution => 'delete_it')`, "22023"),
      probe("resolve_null_resolution", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => '${A1}', p_resolution => null)`, "22023"),
      probe("resolve_already_sent", `select public.resolve_stale_claim(p_id => ${rid(3)}, p_actor => '${A1}', p_resolution => 'mark_sent')`, "P0001", "invalid_state"),
    ]),
    scalar("events_before", "select count(*) from public.admin_message_events"),
    asService([
      callOk("resolve_mark_sent", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => '${A1}', p_resolution => 'mark_sent')`),
      callOk("resolve_release", `select public.resolve_stale_claim(p_id => ${rid(4)}, p_actor => '${A1}', p_resolution => 'release_for_retry')`),
      callOk("resolve_admin_claim", `select public.resolve_stale_claim(p_id => (select d.id from public.notification_deliveries d where d.subject_id = '${M1}'), p_actor => '${A1}', p_resolution => 'release_for_retry')`),
      probe("resolve_twice", `select public.resolve_stale_claim(p_id => ${rid(2)}, p_actor => '${A1}', p_resolution => 'mark_sent')`, "P0001", "invalid_state"),
    ]),
    scalar("sent_by_resolution", `select (sent_at is not null and released_at is null)::text from public.notification_deliveries where id = ${rid(2)}`),
    scalar("released_by_resolution", `select (released_at is not null and sent_at is null)::text from public.notification_deliveries where id = ${rid(4)}`),
    scalar("event_rows", `select string_agg(e.event || '|' || e.detail::text || '|' || coalesce(e.actor_admin_id::text, '-') || '|' || coalesce(e.actor_email, '-') || '|' || (e.message_id is not null)::text, ' ; ' order by e.detail::text, (e.message_id is null)) from public.admin_message_events e`),
    // after a human released it, a retry may claim it again
    asService([claim("claim_after_release_for_retry", args(U1, "match_alert", sub(4), "email"))]),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("it lists open claims of the channel older than the limit, with kind, channel and time only (no user, no address)", () => {
    expect(r.res.stale_email_count).toBe("3");
    expect(r.res.stale_email_ids).toBe("admin_message:email,match_alert:email,match_alert:email");
    expect(r.res.stale_inapp_count).toBe("1");
    expect(r.res.stale_none_other_channel).toBe("0");
    expect(r.res.stale_negative).toBe("ok");
  });
  it("the age is strict: a claim exactly as old as the limit is not stale", () => expect(r.res.exactly_as_old_not_stale).toBe("0"));
  it("a stale e-mail claim is not released by any automatic path and is not re-sent by a retry", () => {
    expect(r.res.retry_after_crash).toBe("null/already_claimed");
    expect(r.res.auto_release_refused).toBe("ok");
    expect(r.res.pruned).toBe("0");
    expect(r.res.email_still_open).toBe("true");
  });
  it("resolving a stale claim needs the user_messaging permission (null, unknown, or an admin without it: 42501)", () => {
    for (const k of ["resolve_no_permission", "resolve_null_actor", "resolve_unknown_actor"]) expect(r.res[k], k).toBe("ok");
  });
  it("an unknown claim is not_found, an unknown resolution is 22023, an already-finished claim is invalid_state", () => {
    expect(r.res.resolve_unknown_claim).toBe("ok");
    expect(r.res.resolve_bad_resolution).toBe("ok");
    expect(r.res.resolve_null_resolution).toBe("ok");
    expect(r.res.resolve_already_sent).toBe("ok");
    expect(r.res.resolve_twice).toBe("ok");
  });
  it("mark_sent stamps sent_at, release_for_retry stamps released_at, and nothing else changes", () => {
    expect(r.res.resolve_mark_sent).toBe("ok");
    expect(r.res.resolve_release).toBe("ok");
    expect(r.res.sent_by_resolution).toBe("true");
    expect(r.res.released_by_resolution).toBe("true");
  });
  it("each resolution writes one claim_resolved audit event with the actor, the actor's e-mail snapshot and only the resolution in the detail; the message is linked only for an admin message", () => {
    expect(r.res.events_before).toBe("0");
    expect(r.res.event_rows).toBe(
      [
        `claim_resolved|{"resolution": "mark_sent"}|${A1}|${A1}@example.test|false`,
        `claim_resolved|{"resolution": "release_for_retry"}|${A1}|${A1}@example.test|true`,
        `claim_resolved|{"resolution": "release_for_retry"}|${A1}|${A1}@example.test|false`,
      ].join(" ; "),
    );
  });
  it("a claim a human released for retry can be claimed again", () => expect(r.res.claim_after_release_for_retry).toBe("id/-"));
});

describe("unread_notification_count", () => {
  const body = [
    FIXTURES,
    `insert into public.user_notifications (user_id, read_at) values ('${U1}', null), ('${U1}', null), ('${U1}', now()), ('${U2}', null);`,
    asService([
      scalar("u1", `select public.unread_notification_count(p_user => '${U1}')`),
      scalar("u2", `select public.unread_notification_count(p_user => '${U2}')`),
      scalar("nobody", `select public.unread_notification_count(p_user => '${UNKNOWN}')`),
      scalar("null_user", "select public.unread_notification_count(p_user => null)"),
    ]),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("it counts the person's unread rows only; a stranger or null has none", () => {
    expect([r.res.u1, r.res.u2, r.res.nobody, r.res.null_user]).toEqual(["2", "1", "0", "0"]);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* prune_notification_deliveries                                                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

describe("prune_notification_deliveries (N1-R12, N1-R26 f)", () => {
  const MONTH = "(date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')";
  const row = (n: number, channel: string, at: string, state: "sent" | "released" | "open") =>
    direct(U1, "match_alert", sub(n), channel, null, at, state === "sent" ? "sent_at=now()" : state === "released" ? "released_at=now()" : "");
  const gone = (n: number) => scalar(`gone_${n}`, `select (not exists (select 1 from public.notification_deliveries where subject_id = '${sub(n)}'))::text`);
  const body = [
    FIXTURES,
    // default 30 days: old finished non-email rows go; open, email and current-month rows stay
    row(1, "inapp", `${MONTH} - interval '40 days'`, "sent"),
    row(2, "push", `${MONTH} - interval '41 days'`, "released"),
    row(3, "inapp", `${MONTH} - interval '40 days'`, "open"),
    row(4, "email", `${MONTH} - interval '40 days'`, "sent"),
    row(5, "email", `${MONTH} - interval '40 days'`, "released"),
    row(6, "inapp", `${MONTH} + (now() - ${MONTH}) / 2`, "sent"),
    row(7, "inapp", MONTH, "sent"),
    asService([scalar("deleted_default", "select public.prune_notification_deliveries()")]),
    ...[1, 2, 3, 4, 5, 6, 7].map(gone),
    // the limit argument: one day, with a row two days before the month and the month's own first instant
    row(11, "inapp", `${MONTH} - interval '2 days'`, "sent"),
    row(12, "inapp", MONTH, "sent"),
    asService([scalar("deleted_one_day", "select public.prune_notification_deliveries(p_older_than_days => 1)")]),
    gone(11),
    gone(12),
    // the age is strict, with the month rule out of the way (45 days is always before the month start)
    row(21, "inapp", "now() - interval '45 days'", "sent"),
    row(22, "inapp", "now() - interval '45 days' - interval '1 microsecond'", "sent"),
    asService([scalar("deleted_strict", "select public.prune_notification_deliveries(p_older_than_days => 45)")]),
    gone(21),
    gone(22),
    asService([
      probe("zero", "select public.prune_notification_deliveries(p_older_than_days => 0)", "22023"),
      probe("negative", "select public.prune_notification_deliveries(p_older_than_days => -5)", "22023"),
      probe("null_days", "select public.prune_notification_deliveries(p_older_than_days => null)", "22023"),
      probe("too_large", "select public.prune_notification_deliveries(p_older_than_days => 36501)", "22023"),
    ]),
    scalar("meta", "select p.proisstrict::text || '/' || coalesce(p.proconfig::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'prune_notification_deliveries'"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("old finished non-email rows go (sent or released), and the count is returned", () => {
    expect(r.res.gone_1).toBe("true");
    expect(r.res.gone_2).toBe("true");
    expect(r.res.deleted_default).toBe("2");
  });
  it("open claims, e-mail rows and rows inside the current UTC month survive", () => {
    for (const n of [3, 4, 5, 6, 7]) expect(r.res[`gone_${n}`], `row ${n}`).toBe("false");
  });
  it("a row exactly at the first instant of the current UTC month is kept (N1-R26 f); one before it, older than the limit, goes", () => {
    expect(r.res.gone_12).toBe("false");
    expect(r.res.gone_11).toBe("true");
    expect(r.res.deleted_one_day).toBe("1");
  });
  it("the age is strict: a row exactly as old as the limit stays, one microsecond older goes", () => {
    expect(r.res.gone_21).toBe("false");
    expect(r.res.gone_22).toBe("true");
    expect(r.res.deleted_strict).toBe("1");
  });
  it("a limit below 1, a null limit (the function is NOT strict) and an absurd one raise 22023", () => {
    for (const k of ["zero", "negative", "null_days", "too_large"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.meta.startsWith("false/")).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* the function catalogue and EXECUTE per role                                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

describe("the functions: exact list, flags and EXECUTE per role (N1-R2, N1-R5, grants addendum)", () => {
  const dummy: Record<string, string> = {
    claim_notification: `p_user => '${U1}', p_kind => 'match_alert', p_subject => '${UNKNOWN}', p_channel => 'inapp'`,
    release_notification: `p_id => '${UNKNOWN}', p_reason => 'gone'`,
    mark_notification_sent: `p_id => '${UNKNOWN}'`,
    stale_notification_claims: "p_channel => 'email', p_older_than => interval '1 hour'",
    resolve_stale_claim: `p_id => '${UNKNOWN}', p_actor => '${A2}', p_resolution => 'mark_sent'`,
    unread_notification_count: `p_user => '${U1}'`,
    prune_notification_deliveries: "p_older_than_days => 30",
    resolve_admin_segment: `p_key => 'everyone', p_params => '{}'::jsonb, p_actor => '${A2}'`,
    prepare_admin_message: `p_message => '${UNKNOWN}', p_actor => '${A2}', p_max_audience => 10`,
    submit_admin_message: `p_message => '${UNKNOWN}', p_actor => '${A2}'`,
    approve_admin_message: `p_message => '${UNKNOWN}', p_actor => '${A2}', p_kind_confirmed => 'promotion'`,
    cancel_admin_message: `p_message => '${UNKNOWN}', p_actor => '${A2}'`,
    start_admin_message_send: `p_message => '${UNKNOWN}', p_actor => '${A2}'`,
    admin_message_audit: `p_actor => '${A2}'`,
    record_admin_message_test: `p_message => '${UNKNOWN}', p_actor => '${A2}'`,
    set_notification_setting: `p_key => 'mass_email_cap_24h', p_value => 5, p_actor => '${A2}'`,
    pause_admin_message_send: `p_message => '${UNKNOWN}', p_reason => 'cap_24h'`,
    resume_admin_message_send: `p_message => '${UNKNOWN}', p_actor => '${A2}'`,
    admin_email_eligible_recipients: "p_user_ids => array[]::uuid[], p_stream => 'announcements'",
  };
  // the ledger functions that only the service role may call (register_push_subscription is the signed-in person's and has its own tests)
  const callables = NAMES.filter((n) => FUNCTIONS[n].callable && FUNCTIONS[n].role === "service_role" && dummy[n]);
  const body = [
    FIXTURES,
    scalar("all_names", `select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ${NAME_LIST}`),
    scalar("overloads", `select count(*) - count(distinct p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ${NAME_LIST}`),
    // any function in public that the migration ADDS and that is not in the FUNCTIONS table is a failure (a new unlisted function, invoker or not)
    scalar("unlisted_new_functions", `select coalesce(string_agg(p.proname, ',' order by p.proname), 'none') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in (select n from n1_pre_fns) and p.proname not in ${NAME_LIST}`),
    scalar("not_definer", `select coalesce(string_agg(p.proname, ',' order by p.proname), 'none') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ${NAME_LIST} and not p.prosecdef`),
    scalar("immutable_or_strict", `select coalesce(string_agg(p.proname, ',' order by p.proname), 'none') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ${NAME_LIST} and (p.provolatile = 'i' or p.proisstrict)`),
    scalar("quiet_hours_acl", `select coalesce(string_agg(g.rolname, ',' order by g.rolname), 'nobody') from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a join pg_roles g on g.oid = a.grantee where p.proname = 'notification_in_quiet_hours' and p.pronamespace = 'public'::regnamespace and g.rolname in ('anon', 'authenticated', 'service_role')`),
    ...NAMES.flatMap((n) => [
      scalar(`flags_${n}`, `select p.proisstrict::text || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '${n}'`),
      scalar(`acl_${n}`, `select coalesce(string_agg(coalesce(g.rolname, 'PUBLIC'), ',' order by g.rolname), 'nobody') from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee where p.pronamespace = 'public'::regnamespace and p.proname = '${n}' and a.grantee <> p.proowner`),
    ]),
    ...(["anon", "authenticated"] as const).flatMap((role) =>
      callables.map((n) => asRole(role, [probe(`${role}_${n}`, `select * from public.${n}(${dummy[n]})`, "42501")], role === "authenticated" ? U1 : undefined)),
    ),
  ].join("\n");
  const r = replay0265(body, { prelude: "create temp table n1_pre_fns as select p.proname::text as n from pg_proc p where p.pronamespace = 'public'::regnamespace;" });

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("no function other than those of the FUNCTIONS table is added (an unlisted invoker function would be one)", () => expect(r.res.unlisted_new_functions).toBe("none"));
  it("the migration creates exactly the functions of the FUNCTIONS table, each once (no overloads)", () => {
    expect(r.res.all_names).toBe([...NAMES].sort().join(","));
    expect(r.res.overloads).toBe("0");
  });
  it("every function is a security definer except exactly the allow-listed trigger guards and the quiet-hours helper (N1-R33); none is immutable or strict; the helper is executable by none of the client roles or service_role", () => {
    expect(r.res.not_definer).toBe([...INVOKER_ALLOWED].sort().join(","));
    expect(Object.entries(FUNCTIONS).filter(([, f]) => !f.definer).map(([n]) => n).sort()).toEqual([...INVOKER_ALLOWED].sort());
    expect(r.res.immutable_or_strict).toBe("none");
    expect(r.res.quiet_hours_acl).toBe("nobody");
  });
  it.each(NAMES)("%s is not strict, has the right security flag and an empty search_path", (n) => {
    expect(r.res[`flags_${n}`]).toBe(`false/${FUNCTIONS[n].definer}/${CONFIG}`);
  });
  it.each(NAMES)("%s: EXECUTE is held by exactly the right role", (n) => {
    expect(r.res[`acl_${n}`]).toBe(FUNCTIONS[n].role);
  });
  it("anon and authenticated are refused with 42501 by every callable function (the grant is the mechanism, there is no role check in a body)", () => {
    for (const role of ["anon", "authenticated"]) for (const n of callables) expect(r.res[`${role}_${n}`], `${role} ${n}`).toBe("ok");
  });
});

