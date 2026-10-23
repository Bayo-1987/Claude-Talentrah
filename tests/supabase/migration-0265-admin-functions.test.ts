/**
 * Migration 0265, part 4: the admin-message functions (prompt 01 sections 2.7 and 2.8). Replayed in a private scratch database in rolled-back transactions. The functions are called as the owner
 * (the grants are proved in migration-0265-functions.test.ts and over HTTP in migration-0265-functions-api.test.ts); what these tests prove is what each function DOES: who may call it, the order
 * of its checks, the states it moves a message through, what it writes and what it refuses.
 *
 * The scratch database holds stand-ins for profiles, organisations, the QA test and auth.users (SCRATCH_BOOTSTRAP); the real ones are read by the applied-database test. Service set of the local
 * stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { A1, A2, FIXTURES, M1, M2, U1, U2, personSql, probe, replay0265, scalar } from "./migration-0265-support";
import { A3, A4, FLAGS_ON, M3, M4, M5, M6, OPERATORS, P, UNKNOWN, call, flag, idList, ids, msg, sel } from "./migration-0265-admin-support";

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
describe("who may call each admin function, and what an unknown message does", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    msg(M1, { by: A2 }),
    // an operator with no permission, and a missing operator: refused by every function
    ...(
      [
        ["prepare", call.prepare(M1, A1)],
        ["submit", call.submit(M1, A1)],
        ["approve", call.approve(M1, A1, "service_announcement")],
        ["cancel", call.cancel(M1, A1)],
        ["start", call.start(M1, A1)],
        ["audit", call.audit(A1)],
        ["test", call.test(M1, A1)],
        ["resume", call.resume(M1, A1)],
        ["resolve", call.resolve("everyone", "{}", A1)],
        ["setting", call.setting("mass_email_cap_24h", 5, A1)],
      ] as const
    ).map(([n, c]) => probe(`noperm_${n}`, sel(c), "42501")),
    ...(
      [
        ["prepare", call.prepare(M1, null)],
        ["submit", call.submit(M1, null)],
        ["approve", call.approve(M1, null, "service_announcement")],
        ["cancel", call.cancel(M1, null)],
        ["start", call.start(M1, null)],
        ["audit", call.audit(null)],
        ["test", call.test(M1, null)],
        ["resume", call.resume(M1, null)],
        ["setting", call.setting("mass_email_cap_24h", 5, null)],
      ] as const
    ).map(([n, c]) => probe(`nullactor_${n}`, sel(c), "42501")),
    // resolve_admin_segment is NOT strict: a null actor is a parameter error, raised before the permission check
    probe("nullactor_resolve", sel(call.resolve("everyone", "{}", null)), "22023"),
    // the setting needs the operators permission: a messaging operator is refused, the operators holder is not
    probe("setting_needs_operators", sel(call.setting("mass_email_cap_24h", 5, A2)), "42501"),
    // a permitted operator and an unknown message
    ...(
      [
        ["prepare", call.prepare(UNKNOWN, A2)],
        ["submit", call.submit(UNKNOWN, A2)],
        ["approve", call.approve(UNKNOWN, A2, "service_announcement")],
        ["cancel", call.cancel(UNKNOWN, A2)],
        ["start", call.start(UNKNOWN, A2)],
        ["test", call.test(UNKNOWN, A2)],
        ["resume", call.resume(UNKNOWN, A2)],
        ["pause", call.pause(UNKNOWN, "cap_24h")],
      ] as const
    ).map(([n, c]) => probe(`unknown_${n}`, sel(c), "P0001", "not_found")),
    // the permission is checked INSIDE: a disabled operator who held it is refused too
    `update public.admin_users set disabled_at = now() where id = '${A3}';`,
    probe("disabled_operator", sel(call.submit(M1, A3)), "42501"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("an operator without user_messaging is refused (42501) by every admin function, called directly", () => {
    for (const n of ["prepare", "submit", "approve", "cancel", "start", "audit", "test", "resume", "resolve", "setting"]) expect(r.res[`noperm_${n}`], n).toBe("ok");
  });
  it("a missing operator is 42501 everywhere, except resolve_admin_segment where it is 22023 (the function is not strict)", () => {
    for (const n of ["prepare", "submit", "approve", "cancel", "start", "audit", "test", "resume", "setting"]) expect(r.res[`nullactor_${n}`], n).toBe("ok");
    expect(r.res.nullactor_resolve).toBe("ok");
  });
  it("changing a setting needs the operators permission, not user_messaging", () => expect(r.res.setting_needs_operators).toBe("ok"));
  it("an unknown message is P0001 not_found for every function that takes one", () => {
    for (const n of ["prepare", "submit", "approve", "cancel", "start", "test", "resume", "pause"]) expect(r.res[`unknown_${n}`], n).toBe("ok");
  });
  it("the permission is read at call time: a disabled operator is refused", () => expect(r.res.disabled_operator).toBe("ok"));
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
describe("resolve_admin_segment: the closed list of segments", () => {
  const pop = {
    P1: P(1), // seeker, active now, "Nigeria"
    P2: P(2), // seeker, 45 days inactive, " nigeria "
    P3: P(3), // seeker, 100 days inactive, "Other"
    P4: P(4), // seeker, never active, no country
    E1: P(11), // member of an unverified organisation, 200 days inactive
    E2: P(12), // member of a verified organisation
    E3: P(13), // member of both
    DEL: P(21), // pending deletion
    QA: P(22), // QA account
  };
  const setup = [
    FIXTURES,
    OPERATORS,
    ...Object.values(pop).map((id) => personSql(id, id === pop.QA ? `${id}@qa.example.test` : undefined)),
    `update public.profiles set created_at = '2020-01-01 00:00:00+00';`,
    `update public.profiles set last_active_at = now(), country = 'Nigeria', created_at = '2026-10-10 00:00:00+00' where id = '${pop.P1}';`,
    `update public.profiles set last_active_at = now() - interval '45 days', country = '  nigeria ' where id = '${pop.P2}';`,
    `update public.profiles set last_active_at = now() - interval '100 days', country = 'Other', created_at = '2026-10-01 00:00:00+00' where id = '${pop.P3}';`,
    `update public.profiles set created_at = '2026-09-30 23:59:59+00' where id = '${pop.P4}';`,
    `update public.profiles set last_active_at = now() - interval '200 days' where id = '${pop.E1}';`,
    `update public.profiles set created_at = '2026-12-31 00:00:00+00' where id = '${pop.E2}';`,
    `update public.profiles set deletion_requested_at = now(), country = 'Nigeria', last_active_at = now() - interval '300 days', created_at = '2026-11-01 00:00:00+00' where id = '${pop.DEL}';`,
    `update public.profiles set country = 'Nigeria', last_active_at = now() - interval '300 days', created_at = '2026-11-01 00:00:00+00' where id = '${pop.QA}';`,
    "insert into public.organizations (id, verified) values ('00000000-0000-4000-8000-0000000000f1', false), ('00000000-0000-4000-8000-0000000000f2', true);",
    `insert into public.organization_members (organization_id, user_id) values ('00000000-0000-4000-8000-0000000000f1', '${pop.E1}'), ('00000000-0000-4000-8000-0000000000f2', '${pop.E2}'), ('00000000-0000-4000-8000-0000000000f1', '${pop.E3}'), ('00000000-0000-4000-8000-0000000000f2', '${pop.E3}');`,
  ];
  const seg = (name: string, key: string, params = "{}", actor = A2) => scalar(name, ids(call.resolve(key, params, actor)));
  const body = [
    ...setup,
    seg("everyone", "everyone"),
    seg("seekers", "seekers"),
    seg("employers", "employers"),
    seg("verified", "verified_employers"),
    seg("inactive30", "inactive_seekers", '{"days":30}'),
    seg("inactive60", "inactive_seekers", '{"days":60}'),
    seg("inactive90", "inactive_seekers", '{"days":90}'),
    seg("since", "signed_up_since", '{"since":"2026-10-01"}'),
    seg("country", "country", '{"country":"nigeria"}'),
    seg("country_padded_upper", "country", '{"country":"  NIGERIA "}'),
    seg("country_other", "country", '{"country":"Other"}'),
    seg("country_other_lower", "country", '{"country":" other "}'),
    seg("country_empty", "country", '{"country":""}'),
    seg("country_missing", "country", "{}"),
    seg("self_a2", "self_test", "{}", A2),
    seg("self_a3", "self_test", "{}", A3),
    seg("unused_param_ignored", "everyone", '{"days":30}'),
    ...(
      [
        ["unknown_key", "everyone", '{"x":1}'],
        ["unknown_key_next_to_good", "inactive_seekers", '{"days":30,"x":1}'],
        ["days_missing", "inactive_seekers", "{}"],
        ["days_45", "inactive_seekers", '{"days":45}'],
        ["days_string", "inactive_seekers", '{"days":"30"}'],
        ["days_null", "inactive_seekers", '{"days":null}'],
        ["days_30_point_0", "inactive_seekers", '{"days":30.0}'],
        ["days_30_point_5", "inactive_seekers", '{"days":30.5}'],
        ["since_missing", "signed_up_since", "{}"],
        ["since_slashes", "signed_up_since", '{"since":"10/01/2026"}'],
        ["since_month_13", "signed_up_since", '{"since":"2026-13-45"}'],
        ["since_number", "signed_up_since", '{"since":20261001}'],
        ["params_array", "everyone", "[]"],
        ["params_scalar", "everyone", "5"],
        ["key_unknown", "admins", "{}"],
        ["key_case", "Everyone", "{}"],
      ] as const
    ).map(([n, k, pr]) => probe(n, sel(call.resolve(k, pr, A2)), "22023")),
    probe("params_null", sel(call.resolve("everyone", null, A2)), "22023"),
    probe("key_null", sel(call.resolve(null, "{}", A2)), "22023"),
    scalar("meta", "select p.proisstrict::text || '/' || p.prosecdef::text || '/' || p.proretset::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_admin_segment'"),
  ].join("\n");
  const r = replay0265(body);
  const visible = [U1, U2, A1, A2, A3, A4, pop.P1, pop.P2, pop.P3, pop.P4, pop.E1, pop.E2, pop.E3];
  const employers = [pop.E1, pop.E2, pop.E3];
  const seekers = visible.filter((id) => !employers.includes(id));

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("everyone is every profile except a pending deletion and a QA account; an employer is a member of an organisation, a verified one of a verified organisation", () => {
    expect(r.res.everyone).toBe(idList(...visible));
    expect(r.res.seekers).toBe(idList(...seekers));
    expect(r.res.employers).toBe(idList(...employers));
    expect(r.res.verified).toBe(idList(pop.E2, pop.E3));
  });
  it("inactive seekers are seekers (never employers, never someone who was never active) whose last activity is older than the window", () => {
    expect(r.res.inactive30).toBe(idList(pop.P2, pop.P3));
    expect(r.res.inactive60).toBe(idList(pop.P3));
    expect(r.res.inactive90).toBe(idList(pop.P3));
  });
  it("signed_up_since is inclusive of the first instant of the day (UTC) and exclusive of the second before it", () => expect(r.res.since).toBe(idList(pop.P1, pop.P3, pop.E2)));
  it("the country segment matches a display name exactly, ignoring case and surrounding spaces; null, empty and Other never match", () => {
    expect(r.res.country).toBe(idList(pop.P1, pop.P2));
    expect(r.res.country_padded_upper).toBe(idList(pop.P1, pop.P2));
    for (const k of ["country_other", "country_other_lower", "country_empty", "country_missing"]) expect(r.res[k], k).toBe("none");
  });
  it("self_test is the acting operator's own account only", () => {
    expect(r.res.self_a2).toBe(A2);
    expect(r.res.self_a3).toBe(A3);
  });
  it("every segment excludes pending-deletion and QA accounts (both are matched by the country, inactivity and date rules above and still absent)", () => {
    for (const k of ["everyone", "seekers", "country", "since", "inactive30", "inactive90"]) {
      expect(r.res[k], k).not.toContain(pop.DEL);
      expect(r.res[k], k).not.toContain(pop.QA);
    }
  });
  it("a parameter a segment does not use is ignored", () => expect(r.res.unused_param_ignored).toBe(idList(...visible)));
  it.each([
    "unknown_key", "unknown_key_next_to_good", "days_missing", "days_45", "days_string", "days_null", "days_30_point_0", "days_30_point_5", "since_missing", "since_slashes", "since_month_13", "since_number", "params_array", "params_scalar", "key_unknown", "key_case", "params_null", "key_null",
  ])("%s is 22023", (n) => expect(r.res[n]).toBe("ok"));
  it("the function is not strict, is a definer and returns a set", () => expect(r.res.meta).toBe("false/true/true"));
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
describe("prepare_admin_message: recipients, per-channel flags, the frozen count and the refusals", () => {
  const R = (n: number) => P(n);
  const people = Array.from({ length: 9 }, (_, i) => R(i + 1));
  const setup = [
    FIXTURES,
    OPERATORS,
    ...people.map((id) => personSql(id)),
    `update public.profiles set country = 'Testland', last_active_at = now() - interval '2 days', email = id || '@example.test' where id = any (array[${people.map((p) => `'${p}'`).join(", ")}]::uuid[]);`,
    `update auth.users set email_confirmed_at = now();`,
    // R3 has push off; R4's only device is revoked; R5 turned announcement e-mail off; R6 never confirmed the address; R7 has a blank profile address; R8 was last active 40 days ago; R9 never
    `update public.email_preferences set push_enabled = true where user_id = any (array[${people.map((p) => `'${p}'`).join(", ")}]::uuid[]);`,
    `update public.email_preferences set push_enabled = false where user_id = '${R(3)}';`,
    `update public.email_preferences set email_announcements = false where user_id = '${R(5)}';`,
    `update public.email_preferences set push_promotions = true where user_id = '${R(1)}';`,
    `update public.email_preferences set email_promotions = true where user_id = any (array['${R(1)}', '${R(4)}', '${R(5)}', '${R(6)}', '${R(7)}', '${R(8)}', '${R(9)}']::uuid[]);`,
    `update auth.users set email_confirmed_at = null where id = '${R(6)}';`,
    `update public.profiles set email = '   ' where id = '${R(7)}';`,
    `update public.profiles set last_active_at = now() - interval '40 days' where id = '${R(8)}';`,
    `update public.profiles set last_active_at = null where id = '${R(9)}';`,
    ...people.map((id, i) => `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua_short, revoked_at) values ('${id}', 'https://push.example.invalid/${i}', 'k', 'a', 'Chrome', ${i === 3 ? "now()" : "null"});`),
    FLAGS_ON,
    msg(M1, { kind: "service_announcement", channels: "array['inapp','push','email']", key: "country", params: '{"country":"testland"}' }),
    msg(M2, { kind: "promotion", channels: "array['inapp','push','email']", key: "country", params: '{"country":"testland"}' }),
  ];
  const rowsOf = (m: string) => `select string_agg(right(user_id::text, 4) || '=' || to_inapp::int || to_push::int || to_email::int, ',' order by user_id) from public.admin_message_recipients where message_id = '${m}'`;
  const body = [
    ...setup,
    scalar("count_m1", sel(call.prepare(M1, A2))),
    scalar("rows_m1", rowsOf(M1)),
    scalar("state_m1", `select status || '/' || audience_count from public.admin_messages where id = '${M1}'`),
    scalar("rowcount_m1", `select count(*) from public.admin_message_recipients where message_id = '${M1}'`),
    scalar("event_m1", `select count(*) || '/' || min(actor_admin_id::text) || '/' || min(actor_email) from public.admin_message_events where message_id = '${M1}' and event = 'prepared'`),
    scalar("count_m2", sel(call.prepare(M2, A2))),
    scalar("rows_m2", rowsOf(M2)),
    msg(M3, { channels: "array['email']", key: "country", params: '{"country":"testland"}' }),
    scalar("count_m3", sel(call.prepare(M3, A2))),
    scalar("rows_m3", rowsOf(M3)),
    // the content of a prepared message cannot change; its status can
    probe("edit_title", `update public.admin_messages set title = 'Other' where id = '${M1}'`, "P0001", "invalid_state"),
    probe("edit_channels", `update public.admin_messages set channels = array['inapp'] where id = '${M1}'`, "P0001", "invalid_state"),
    probe("prepare_twice", sel(call.prepare(M1, A2)), "P0001", "invalid_state"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("an announcement queues everyone in the segment: in-app for all, push for opted-in people with an active device, e-mail for people whose announcements are on, confirmed, with an address and active in 30 days", () => {
    expect(r.res.rows_m1).toBe(
      [
        "f001=111", // everything
        "f002=111",
        "f003=101", // push master off
        "f004=101", // only device revoked
        "f005=110", // announcement e-mail off
        "f006=110", // address not confirmed
        "f007=110", // blank profile address
        "f008=110", // inactive 40 days
        "f009=110", // never active
      ].join(","),
    );
  });
  it("a promotion needs the promotion switch for push and the promotion column for e-mail", () => {
    expect(r.res.rows_m2).toBe(["f001=111", "f002=100", "f003=100", "f004=101", "f005=101", "f006=100", "f007=100", "f008=100", "f009=100"].join(","));
  });
  it("a channel that was not chosen is not queued: an e-mail-only message queues no in-app row flag and no push", () => {
    expect(r.res.count_m3).toBe("9");
    expect(r.res.rows_m3).toBe(["f001=001", "f002=001", "f003=001", "f004=001", "f005=000", "f006=000", "f007=000", "f008=000", "f009=000"].join(","));
  });
  it("the stored count equals the number of recipient rows queued, and equals what the call returned", () => {
    expect([r.res.count_m1, r.res.rowcount_m1, r.res.state_m1]).toEqual(["9", "9", "prepared/9"]);
    expect(r.res.count_m2).toBe("9");
  });
  it("preparing writes one prepared event naming the operator", () => expect(r.res.event_m1).toBe(`1/${A2}/${A2}@example.test`));
  it("a prepared message cannot be edited, and cannot be prepared again", () => {
    for (const k of ["edit_title", "edit_channels", "prepare_twice"]) expect(r.res[k], k).toBe("ok");
  });
});

describe("prepare_admin_message: flags, consent, audience limits and the daily limits", () => {
  const manyUsers = (n: number) => `insert into auth.users (id, email, instance_id, aud, role) select gen_random_uuid(), 'bulk' || g || '@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated' from generate_series(1, ${n}) g;`;
  const body = [
    FIXTURES,
    OPERATORS,
    // flags: all off after the migration
    msg(M1, { key: "self_test" }),
    msg(M2, { kind: "promotion", key: "self_test" }),
    msg(M3, { key: "self_test", channels: "array['inapp','email']" }),
    probe("flags_all_off", sel(call.prepare(M1, A2)), "P0001", "flag_off"),
    flag("notifications_master", true),
    probe("only_master", sel(call.prepare(M1, A2)), "P0001", "flag_off"),
    flag("notifications_master", false),
    flag("admin_messaging", true),
    probe("only_messaging", sel(call.prepare(M1, A2)), "P0001", "flag_off"),
    flag("notifications_master", true),
    probe("promotion_needs_its_flag", sel(call.prepare(M2, A2)), "P0001", "flag_off"),
    probe("email_needs_its_flag", sel(call.prepare(M3, A2)), "P0001", "flag_off"),
    flag("admin_promotions", true),
    flag("admin_email", true),
    // a missing flag row means off
    `delete from public.feature_flags where key = 'admin_messaging';`,
    probe("missing_row_is_off", sel(call.prepare(M1, A2)), "P0001", "flag_off"),
    `insert into public.feature_flags (key, label, enabled) values ('admin_messaging', 'Admin messages: enabled', true);`,
    // consent: a promotion carries a non-blank snapshot
    `update public.admin_messages set consent_line = null where id = '${M2}';`,
    probe("consent_null", sel(call.prepare(M2, A2)), "P0001", "consent_required"),
    `update public.admin_messages set consent_line = '   ' where id = '${M2}';`,
    probe("consent_blank", sel(call.prepare(M2, A2)), "P0001", "consent_required"),
    `update public.admin_messages set consent_line = 'You asked for offers.' where id = '${M2}';`,
    scalar("promotion_ok", sel(call.prepare(M2, A2))),
    // parameter errors
    probe("max_null", sel(call.prepare(M1, A2, "null")), "22023"),
    probe("max_negative", sel(call.prepare(M1, A2, -1)), "22023"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a missing flag row is off, and prepare needs the master switch, the messaging flag, the promotion flag for a promotion and the e-mail flag for the e-mail channel", () => {
    for (const k of ["flags_all_off", "only_master", "only_messaging", "promotion_needs_its_flag", "email_needs_its_flag", "missing_row_is_off"]) expect(r.res[k], k).toBe("ok");
  });
  it("a promotion needs a non-blank consent line", () => {
    expect(r.res.consent_null).toBe("ok");
    expect(r.res.consent_blank).toBe("ok");
    expect(r.res.promotion_ok).toBe("1");
  });
  it("a null or negative audience limit is 22023", () => {
    expect(r.res.max_null).toBe("ok");
    expect(r.res.max_negative).toBe("ok");
  });

  describe("the audience limit", () => {
    const audienceBody = [
      FIXTURES,
      OPERATORS,
      FLAGS_ON,
      manyUsers(4),
      msg(M1, { key: "everyone" }),
      msg(M2, { key: "everyone" }),
      scalar("everyone", `select count(*) from ${call.resolve("everyone", "{}", A2)} s`),
      probe("one_over", sel(call.prepare(M1, A2, 9)), "P0001", "audience_over_limit"),
      scalar("nothing_queued_when_refused", `select count(*) from public.admin_message_recipients where message_id = '${M1}'`),
      scalar("exact", sel(call.prepare(M1, A2, 10))),
      probe("zero_limit", sel(call.prepare(M2, A2, 0)), "P0001", "audience_over_limit"),
    ].join("\n");
    const a = replay0265(audienceBody);
    it("the replay applies", () => expect(a.ok, a.stderr).toBe(true));
    it("an audience over the caller's limit is refused and queues nothing; exactly the limit is accepted", () => {
      expect(a.res.everyone).toBe("10");
      expect(a.res.one_over).toBe("ok");
      expect(a.res.nothing_queued_when_refused).toBe("0");
      expect(a.res.exact).toBe("10");
      expect(a.res.zero_limit).toBe("ok");
    });
  });

  describe("the absolute ceiling of 5,000", () => {
    const ceilingBody = [
      FIXTURES,
      OPERATORS,
      FLAGS_ON,
      // FIXTURES holds four profiles (U1, U2, A1, A2) and OPERATORS two more: 6 + 4,994 = exactly 5,000
      manyUsers(4994),
      msg(M1, { key: "everyone" }),
      msg(M2, { key: "everyone" }),
      scalar("everyone_at_ceiling", `select count(*) from ${call.resolve("everyone", "{}", A2)} s`),
      scalar("at_ceiling", sel(call.prepare(M1, A2, 1000000))),
      manyUsers(1),
      probe("over_ceiling_with_huge_limit", sel(call.prepare(M2, A2, 1000000)), "P0001", "audience_over_limit"),
    ].join("\n");
    const c = replay0265(ceilingBody);
    it("the replay applies", () => expect(c.ok, c.stderr).toBe(true));
    it("5,000 people are accepted and 5,001 are refused, whatever limit the caller passes", () => {
      expect(c.res.everyone_at_ceiling).toBe("5000");
      expect(c.res.at_ceiling).toBe("5000");
      expect(c.res.over_ceiling_with_huge_limit).toBe("ok");
    });
  });

  describe("the daily limits count a rolling 24 hours from the start of the send", () => {
    const sent = (id: string, by: string | null, ago: string) => msg(id, { by, status: "sent", approval: false, started: ago });
    const idn = (n: number) => `00000000-0000-4000-8000-0000000e${String(n).padStart(4, "0")}`;
    const limitBody = [
      FIXTURES,
      OPERATORS,
      FLAGS_ON,
      msg(M1, { key: "self_test" }),
      // four sends by A2 inside 24 hours: a fifth may still be prepared
      ...[1, 2, 3, 4].map((n) => sent(idn(n), A2, "23 hours 59 minutes")),
      scalar("fifth_ok", sel(call.prepare(M1, A2))),
      msg(M2, { key: "self_test" }),
      sent(idn(5), A2, "1 hour"),
      probe("sixth_refused", sel(call.prepare(M2, A2)), "P0001", "operator_daily_limit"),
      // another operator is not affected by A2's count
      msg(M3, { by: A3, key: "self_test" }),
      scalar("other_operator_ok", sel(call.prepare(M3, A3))),
    ].join("\n");
    const l = replay0265(limitBody);
    it("the replay applies", () => expect(l.ok, l.stderr).toBe(true));
    it("a sixth send by one operator inside 24 hours is refused; the fifth is allowed; another operator is unaffected", () => {
      expect(l.res.fifth_ok).toBe("1");
      expect(l.res.sixth_refused).toBe("ok");
      expect(l.res.other_operator_ok).toBe("1");
    });

    const rollingBody = [
      FIXTURES,
      OPERATORS,
      FLAGS_ON,
      msg(M1, { key: "self_test" }),
      // five sends that started more than 24 hours ago do not count
      ...[1, 2, 3, 4, 5].map((n) => sent(idn(n), A2, "24 hours 1 minute")),
      scalar("old_sends_do_not_count", sel(call.prepare(M1, A2))),
      // ten sends overall that started 30 hours ago do not count either
      ...[11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => sent(idn(n), null, "30 hours")),
      msg(M2, { by: A3, key: "self_test" }),
      scalar("old_overall_do_not_count", sel(call.prepare(M2, A3))),
    ].join("\n");
    const w = replay0265(rollingBody);
    it("sends older than 24 hours do not count (a rolling window, not a calendar day)", () => {
      expect(w.ok, w.stderr).toBe(true);
      expect(w.res.old_sends_do_not_count).toBe("1");
      expect(w.res.old_overall_do_not_count).toBe("1");
    });

    const overallBody = [
      FIXTURES,
      OPERATORS,
      FLAGS_ON,
      msg(M1, { key: "self_test" }),
      // nine sends overall (by nobody in particular): a tenth may be prepared
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => sent(idn(n), null, "2 hours")),
      scalar("tenth_ok", sel(call.prepare(M1, A2))),
      msg(M2, { key: "self_test" }),
      sent(idn(10), null, "2 hours"),
      probe("eleventh_refused", sel(call.prepare(M2, A2)), "P0001", "overall_daily_limit"),
    ].join("\n");
    const o = replay0265(overallBody);
    it("an eleventh send overall inside 24 hours is refused; the tenth is allowed", () => {
      expect(o.ok, o.stderr).toBe(true);
      expect(o.res.tenth_ok).toBe("1");
      expect(o.res.eleventh_refused).toBe("ok");
    });
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
describe("the message lifecycle: submit, approve, cancel, start, the test record and the audit", () => {
  const M7 = "00000000-0000-4000-8000-0000000000c7";
  const M8 = "00000000-0000-4000-8000-0000000000c8";
  const state = (m: string) => `select status from public.admin_messages where id = '${m}'`;
  const events = (m: string, e: string) => `select count(*) from public.admin_message_events where message_id = '${m}' and event = '${e}'`;
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    msg(M1, { status: "prepared", approval: true }),
    msg(M2), // a draft
    // submit
    probe("submit_draft", sel(call.submit(M2, A2)), "P0001", "invalid_state"),
    `select ${call.submit(M1, A2)};`,
    scalar("after_submit", state(M1)),
    scalar("submit_event", events(M1, "submitted")),
    probe("submit_twice", sel(call.submit(M1, A2)), "P0001", "invalid_state"),
    // a submitted message that needs approval cannot start
    scalar("start_unapproved", sel(call.start(M1, A2))),
    scalar("still_submitted", state(M1)),
    scalar("no_start_event_yet", events(M1, "send_started")),
    // approve
    probe("self_approval", sel(call.approve(M1, A2, "service_announcement")), "P0001", "self_approval"),
    probe("approve_without_permission", sel(call.approve(M1, A4, "service_announcement")), "42501"),
    probe("approve_wrong_kind", sel(call.approve(M1, A3, "promotion")), "P0001", "kind_not_confirmed"),
    probe("approve_null_kind", sel(call.approve(M1, A3, null)), "P0001", "kind_not_confirmed"),
    probe("approve_draft", sel(call.approve(M2, A3, "service_announcement")), "P0001", "invalid_state"),
    scalar("still_submitted_after_refusals", `select status || '/' || coalesce(approved_by::text, 'none') || '/' || coalesce(kind_confirmed_by_approver, 'none') from public.admin_messages where id = '${M1}'`),
    `select ${call.approve(M1, A3, "service_announcement")};`,
    scalar("approved_row", `select status || '/' || approved_by || '/' || approved_by_email || '/' || kind_confirmed_by_approver from public.admin_messages where id = '${M1}'`),
    scalar("approved_event", `select detail::text || '/' || actor_admin_id || '/' || actor_email from public.admin_message_events where message_id = '${M1}' and event = 'approved'`),
    probe("approve_twice", sel(call.approve(M1, A3, "service_announcement")), "P0001", "invalid_state"),
    // start: one conditional update; a repeat sends nothing
    scalar("start_first", `select (${call.start(M1, A2)} = '${M1}')::text`),
    scalar("after_start", `select status || '/' || (sent_started_at is not null)::text from public.admin_messages where id = '${M1}'`),
    scalar("start_second", sel(call.start(M1, A2))),
    scalar("start_events", events(M1, "send_started")),
    // approval not required: a prepared message starts
    msg(M3, { status: "prepared", approval: false }),
    scalar("start_no_approval_needed", `select (${call.start(M3, A2)} = '${M3}')::text`),
    msg(M4, { status: "prepared", approval: true }),
    scalar("start_prepared_needing_approval", sel(call.start(M4, A2))),
    scalar("m4_unchanged", state(M4)),
    // a flag off stops a start without a deploy, and records it
    msg(M5, { status: "approved", approval: false }),
    flag("admin_messaging", false),
    scalar("flag_off_start", sel(call.start(M5, A2))),
    scalar("flag_off_state", state(M5)),
    scalar("flag_off_event", events(M5, "flag_stopped")),
    flag("admin_messaging", true),
    msg(M6, { kind: "promotion", status: "approved", approval: false }),
    flag("admin_promotions", false),
    scalar("promotion_flag_off_start", sel(call.start(M6, A2))),
    flag("admin_promotions", true),
    scalar("flag_on_start", `select (${call.start(M5, A2)} = '${M5}')::text`),
    scalar("promotion_start_after_flag_on", `select (${call.start(M6, A2)} = '${M6}')::text`),
    // cancel
    probe("cancel_sending", sel(call.cancel(M1, A2)), "P0001", "invalid_state"),
    `select ${call.cancel(M4, A2)};`,
    scalar("cancelled", state(M4)),
    scalar("cancel_event", events(M4, "cancelled")),
    probe("cancel_twice", sel(call.cancel(M4, A2)), "P0001", "invalid_state"),
    `select ${call.cancel(M2, A3)};`,
    scalar("draft_cancelled", state(M2)),
    msg(M7, { status: "sent", approval: false, started: "30 hours" }),
    probe("cancel_sent", sel(call.cancel(M7, A2)), "P0001", "invalid_state"),
    // a test send records an event and changes nothing, so it cannot block the real send
    msg(M8, { status: "prepared", approval: false }),
    `select ${call.test(M8, A2)};`,
    scalar("test_event", events(M8, "test_sent")),
    scalar("test_leaves_state", state(M8)),
    scalar("start_after_test", `select (${call.start(M8, A2)} = '${M8}')::text`),
    // the audit
    scalar("audit_m1", `select string_agg(event, ',' order by event) from ${call.audit(A2, M1)} e`),
    scalar("audit_all_count", `select count(*) from ${call.audit(A3)} e`),
    scalar("audit_all_equals_table", `select count(*) from public.admin_message_events`),
    scalar("audit_unknown_message", `select count(*) from ${call.audit(A2, UNKNOWN)} e`),
    scalar("audit_detail", `select e.detail::text from ${call.audit(A2, M1)} e where e.event = 'approved'`),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("submit moves a prepared message to submitted and records it; any other state is invalid_state", () => {
    expect(r.res.submit_draft).toBe("ok");
    expect([r.res.after_submit, r.res.submit_event, r.res.submit_twice]).toEqual(["submitted", "1", "ok"]);
  });
  it("a submitted message that needs approval cannot be started", () => {
    expect([r.res.start_unapproved, r.res.still_submitted, r.res.no_start_event_yet]).toEqual(["NULL", "submitted", "0"]);
  });
  it("a send cannot be approved by its own sender: the function refuses the creator (self_approval)", () => expect(r.res.self_approval).toBe("ok"));
  it("approval is refused without the permission, when the confirmation names the other kind, when it is missing, and outside the submitted state; each refusal changes nothing", () => {
    for (const k of ["approve_without_permission", "approve_wrong_kind", "approve_null_kind", "approve_draft"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.still_submitted_after_refusals).toBe("submitted/none/none");
  });
  it("the confirmation is stored on the message and in the approved event, with the approver", () => {
    expect(r.res.approved_row).toBe(`approved/${A3}/${A3}@example.test/service_announcement`);
    expect(r.res.approved_event).toBe(`{"kind_confirmed": "service_announcement"}/${A3}/${A3}@example.test`);
    expect(r.res.approve_twice).toBe("ok");
  });
  it("a repeat or double start sends nothing extra: the first start returns the message and records one event, the second returns nothing", () => {
    expect([r.res.start_first, r.res.after_start, r.res.start_second, r.res.start_events]).toEqual(["true", "sending/true", "NULL", "1"]);
  });
  it("a prepared message that needs no approval starts; one that needs approval does not", () => {
    expect(r.res.start_no_approval_needed).toBe("true");
    expect([r.res.start_prepared_needing_approval, r.res.m4_unchanged]).toEqual(["NULL", "prepared"]);
  });
  it("a flag turned off stops a start without a deploy: nothing starts, the stop is recorded, and the same call works once the flag is back", () => {
    expect([r.res.flag_off_start, r.res.flag_off_state, r.res.flag_off_event]).toEqual(["NULL", "approved", "1"]);
    expect(r.res.promotion_flag_off_start).toBe("NULL");
    expect([r.res.flag_on_start, r.res.promotion_start_after_flag_on]).toEqual(["true", "true"]);
  });
  it("cancel works from draft, prepared, submitted, approved and paused states, and refuses sending, sent and cancelled", () => {
    expect([r.res.cancelled, r.res.cancel_event, r.res.draft_cancelled]).toEqual(["cancelled", "1", "cancelled"]);
    for (const k of ["cancel_sending", "cancel_twice", "cancel_sent"]) expect(r.res[k], k).toBe("ok");
  });
  it("a test send records an event and changes nothing, so the real send is not blocked", () => {
    expect([r.res.test_event, r.res.test_leaves_state, r.res.start_after_test]).toEqual(["1", "prepared", "true"]);
  });
  it("the audit returns the message's events, all events without a message, none for an unknown message, and the approval detail", () => {
    expect(r.res.audit_m1).toBe("approved,send_started,submitted");
    expect(r.res.audit_all_count).toBe(r.res.audit_all_equals_table);
    expect(r.res.audit_unknown_message).toBe("0");
    expect(r.res.audit_detail).toBe('{"kind_confirmed": "service_announcement"}');
  });
});

describe("pause and resume of a send held by an e-mail limit", () => {
  const M7 = "00000000-0000-4000-8000-0000000000c7";
  const state = (m: string) => `select status from public.admin_messages where id = '${m}'`;
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    msg(M1, { status: "sending", approval: false, started: "1 minute", channels: "array['email']" }),
    msg(M2, { status: "sending", approval: false, started: "1 minute", channels: "array['email']" }),
    msg(M3, { status: "prepared", approval: false }),
    `insert into public.admin_message_recipients (message_id, user_id, to_email) values ('${M1}', '${U1}', true);`,
    probe("pause_bad_reason", sel(call.pause(M1, "daily")), "22023"),
    probe("pause_null_reason", sel(call.pause(M1, null)), "22023"),
    probe("pause_prepared", sel(call.pause(M3, "cap_24h")), "P0001", "invalid_state"),
    `select ${call.pause(M1, "cap_24h")};`,
    `select ${call.pause(M2, "ceiling_month")};`,
    scalar("paused_cap", state(M1)),
    scalar("paused_ceiling", state(M2)),
    probe("pause_twice", sel(call.pause(M1, "cap_24h")), "P0001", "invalid_state"),
    scalar("queued_untouched", `select coalesce(email_outcome, 'empty') || '/' || coalesce(push_outcome, 'empty') from public.admin_message_recipients where message_id = '${M1}'`),
    // resume: the permission, the flags, the state; audited; never automatic
    probe("resume_without_permission", sel(call.resume(M1, A1)), "42501"),
    flag("admin_email", false),
    probe("resume_flag_off", sel(call.resume(M1, A2)), "P0001", "flag_off"),
    scalar("still_paused", state(M1)),
    flag("admin_email", true),
    probe("resume_not_paused", sel(call.resume(M3, A2)), "P0001", "invalid_state"),
    `select ${call.resume(M1, A2)};`,
    `select ${call.resume(M2, A3)};`,
    scalar("resumed_cap", state(M1)),
    scalar("resumed_ceiling", state(M2)),
    scalar("resumed_event", `select count(*) || '/' || min(actor_admin_id::text) from public.admin_message_events where message_id = '${M1}' and event = 'resumed'`),
    probe("resume_sending", sel(call.resume(M1, A2)), "P0001", "invalid_state"),
    msg(M7, { status: "sending", approval: false, started: "1 minute", channels: "array['email']" }),
    `select ${call.pause(M7, "cap_24h")};`,
    `select ${call.cancel(M7, A2)};`,
    scalar("paused_message_can_be_cancelled", state(M7)),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("pause sets the status of the limit that refused, and only from sending; a bad or missing reason is 22023", () => {
    expect([r.res.paused_cap, r.res.paused_ceiling]).toEqual(["paused_email_cap", "paused_email_ceiling"]);
    for (const k of ["pause_bad_reason", "pause_null_reason", "pause_prepared", "pause_twice"]) expect(r.res[k], k).toBe("ok");
  });
  it("a paused message keeps its queued recipients with an empty outcome", () => expect(r.res.queued_untouched).toBe("empty/empty"));
  it("resume needs the permission and the flags, and the message must be paused; a refused resume changes nothing", () => {
    for (const k of ["resume_without_permission", "resume_flag_off", "resume_not_paused", "resume_sending"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.still_paused).toBe("paused_email_cap");
  });
  it("a paused message can be cancelled", () => expect(r.res.paused_message_can_be_cancelled).toBe("cancelled"));
  it("resume moves either paused status back to sending and is audited with the operator", () => {
    expect([r.res.resumed_cap, r.res.resumed_ceiling]).toEqual(["sending", "sending"]);
    expect(r.res.resumed_event).toBe(`1/${A2}`);
  });
});

describe("set_notification_setting: the operators permission, the closed keys, the bounded value and the change log", () => {
  const setting = (k: string) => `select int_value || '/' || coalesce(updated_by_email, 'none') from public.notification_settings where key = '${k}'`;
  const changes = `select string_agg(key || ':' || coalesce(old_value::text, 'null') || '>' || new_value || ':' || actor_admin_id || ':' || actor_email, ' ; ' order by new_value) from public.notification_setting_changes`;
  const body = [
    FIXTURES,
    OPERATORS,
    scalar("defaults", `select string_agg(key || '=' || int_value, ',' order by key) from public.notification_settings`),
    // a missing row is created by the first write, with no old value
    `delete from public.notification_settings where key = 'mass_email_ceiling_month';`,
    `select ${call.setting("mass_email_ceiling_month", 1500, A4)};`,
    scalar("ceiling_row", setting("mass_email_ceiling_month")),
    `select ${call.setting("mass_email_cap_24h", 77, A4)};`,
    scalar("cap_row", setting("mass_email_cap_24h")),
    `select ${call.setting("mass_email_cap_24h", 0, A4)};`,
    `select ${call.setting("mass_email_cap_24h", 10000, A4)};`,
    scalar("after_bounds", setting("mass_email_cap_24h")),
    probe("too_big", sel(call.setting("mass_email_cap_24h", 10001, A4)), "P0001", "setting_value_out_of_range"),
    probe("negative", sel(call.setting("mass_email_cap_24h", -1, A4)), "P0001", "setting_value_out_of_range"),
    probe("null_value", sel(call.setting("mass_email_cap_24h", "null", A4)), "P0001", "setting_value_out_of_range"),
    probe("unknown_key", sel(call.setting("mass_email_other", 5, A4)), "P0001", "setting_key_unknown"),
    probe("null_key", sel(call.setting(null, 5, A4)), "P0001", "setting_key_unknown"),
    probe("key_checked_before_value", sel(call.setting("mass_email_other", 99999, A4)), "P0001", "setting_key_unknown"),
    probe("permission_checked_first", sel(call.setting("mass_email_other", 99999, A2)), "42501"),
    scalar("after_refusals", setting("mass_email_cap_24h")),
    scalar("log", changes),
    scalar("log_rows", "select count(*) from public.notification_setting_changes"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the migration starts with a cap of 50 in 24 hours and a ceiling of 2,000 a month", () => expect(r.res.defaults).toBe("mass_email_cap_24h=50,mass_email_ceiling_month=2000"));
  it("a holder of operators writes the setting with their address; 0 and 10,000 are allowed; a missing row is created", () => {
    expect(r.res.cap_row).toBe(`77/${A4}@example.test`);
    expect(r.res.ceiling_row).toBe(`1500/${A4}@example.test`);
    expect(r.res.after_bounds).toBe(`10000/${A4}@example.test`);
  });
  it("an out-of-range or null value, an unknown or null key are refused with their reason, the key before the value, the permission before both", () => {
    for (const k of ["too_big", "negative", "null_value", "unknown_key", "null_key", "key_checked_before_value", "permission_checked_first"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.after_refusals).toBe(`10000/${A4}@example.test`);
  });
  it("every successful change writes exactly one change row with the old value, the new value and the operator; a refused call writes none", () => {
    expect(r.res.log_rows).toBe("4");
    // ordered by the new value: 0, 77, 1500, 10000
    expect(r.res.log).toBe(
      [`mass_email_cap_24h:77>0`, `mass_email_cap_24h:50>77`, `mass_email_ceiling_month:null>1500`, `mass_email_cap_24h:0>10000`].map((c) => `${c}:${A4}:${A4}@example.test`).join(" ; "),
    );
  });
});

describe("admin_email_eligible_recipients: who may still get a stream by e-mail", () => {
  const E = (n: number) => P(30 + n);
  const body = [
    FIXTURES,
    OPERATORS,
    ...Array.from({ length: 7 }, (_, i) => personSql(E(i + 1))),
    `update auth.users set email_confirmed_at = now();`,
    `update public.profiles set email = id || '@example.test' where id::text like '00000000-0000-4000-8000-00000000f03%';`,
    // E1: announcements (the default) and promotions; E2: both; E3: promotions only; E4: unconfirmed address; E5: blank address; E6: pending deletion; E7: QA account
    `update public.email_preferences set email_promotions = true where user_id in ('${E(2)}', '${E(7)}');`,
    `update public.email_preferences set email_announcements = false where user_id = '${E(3)}';`,
    `update auth.users set email_confirmed_at = null where id = '${E(4)}';`,
    `update public.profiles set email = ' ' where id = '${E(5)}';`,
    `update public.profiles set deletion_requested_at = now() where id = '${E(6)}';`,
    `update public.profiles set email = '${E(7)}@qa.example.test' where id = '${E(7)}';`,
    `update public.email_preferences set email_promotions = true where user_id in ('${E(1)}', '${E(3)}', '${E(4)}', '${E(5)}', '${E(6)}');`,
    scalar("announcements", `select string_agg(s::text, ',') from ${call.eligible(`array['${E(3)}', '${E(2)}', '${E(7)}', '${E(1)}', '${E(4)}', '${E(5)}', '${E(6)}', '${UNKNOWN}']::uuid[]`, "announcements")} s`),
    scalar("promotions", `select string_agg(s::text, ',') from ${call.eligible(`array['${E(3)}', '${E(2)}', '${E(7)}', '${E(1)}', '${E(4)}', '${E(5)}', '${E(6)}', '${UNKNOWN}']::uuid[]`, "promotions")} s`),
    scalar("empty", `select count(*) from ${call.eligible("array[]::uuid[]", "announcements")} s`),
    probe("unknown_stream", sel(call.eligible("array[]::uuid[]", "weekly")), "22023"),
    probe("null_stream", sel(call.eligible("array[]::uuid[]", null)), "22023"),
    probe("null_array", sel(call.eligible("null", "announcements")), "22023"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("it keeps only people with a profile, no pending deletion, not a QA account, the stream on, an address on the profile and a confirmed address, in the order given", () => {
    expect(r.res.announcements).toBe(`${E(2)},${E(1)}`);
    // E3 switched announcements off but kept promotions on, so it is eligible for the other stream only
    expect(r.res.promotions).toBe(`${E(3)},${E(2)},${E(1)}`);
  });
  it("an empty list is empty; an unknown, null stream or a null list is 22023", () => {
    expect(r.res.empty).toBe("0");
    for (const k of ["unknown_stream", "null_stream", "null_array"]) expect(r.res[k], k).toBe("ok");
  });
});

describe("prepare sets requires_approval: a promotion or more than 100 recipients always needs approval, and it is never lowered", () => {
  const manyUsers = (n: number) => `insert into auth.users (id, email, instance_id, aud, role) select gen_random_uuid(), 'bulk' || g || '@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated' from generate_series(1, ${n}) g;`;
  const flagOf = (m: string) => `select requires_approval from public.admin_messages where id = '${m}'`;
  const small = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    msg(M1, { key: "self_test", approval: false }), // an announcement to one person, created without approval
    msg(M2, { key: "self_test", approval: false, kind: "promotion" }), // a promotion to one person, created without approval
    msg(M3, { key: "self_test", approval: true }), // already needs approval: stays
    `select ${call.prepare(M1, A2)};`,
    `select ${call.prepare(M2, A2)};`,
    `select ${call.prepare(M3, A2)};`,
    scalar("announcement_small", flagOf(M1)),
    scalar("promotion_small", flagOf(M2)),
    scalar("never_lowered", flagOf(M3)),
  ].join("\n");
  const rs = replay0265(small);
  const sized = (n: number) =>
    replay0265([FIXTURES, OPERATORS, FLAGS_ON, manyUsers(n), msg(M1, { key: "everyone", approval: false }), scalar("count", sel(call.prepare(M1, A2))), scalar("flag", flagOf(M1))].join("\n"));
  const at100 = sized(94); // 4 + 2 + 94 = 100
  const at101 = sized(95);

  it("the replays apply", () => {
    for (const r of [rs, at100, at101]) expect(r.ok, r.stderr).toBe(true);
  });
  it("an announcement to one person keeps requires_approval false; a promotion to one person gets true", () => {
    expect(rs.res.announcement_small).toBe("false");
    expect(rs.res.promotion_small).toBe("true");
  });
  it("exactly 100 recipients keep requires_approval false; 101 make it true", () => {
    expect([at100.res.count, at100.res.flag]).toEqual(["100", "false"]);
    expect([at101.res.count, at101.res.flag]).toEqual(["101", "true"]);
  });
  it("a message that already needs approval is never lowered", () => expect(rs.res.never_lowered).toBe("true"));
});

describe("start_admin_message_send: the daily limits are checked at start too (F1)", () => {
  const idn = (n: number) => `00000000-0000-4000-8000-0000000e${String(n).padStart(4, "0")}`;
  const sent = (n: number, by: string | null, ago: string) => msg(idn(n), { by, status: "sent", approval: false, started: ago });
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    // A2 has started four sends in the last day: a fifth can start
    ...[1, 2, 3, 4].map((n) => sent(n, A2, "2 hours")),
    msg(M1, { status: "prepared", approval: false }),
    scalar("fifth_starts", `select (${call.start(M1, A2)} = '${M1}')::text`),
    // now five have started: the sixth cannot, and says why; it stays unstarted
    msg(M2, { status: "prepared", approval: false }),
    probe("sixth_refused", sel(call.start(M2, A2)), "P0001", "operator_daily_limit"),
    scalar("sixth_state", `select status || '/' || coalesce(sent_started_at::text, 'none') from public.admin_messages where id = '${M2}'`),
    // another operator's message is not held by A2's count (the limit is by the message's creator)
    msg(M3, { by: A3, status: "prepared", approval: false }),
    scalar("other_creator_starts", `select (${call.start(M3, A3)} = '${M3}')::text`),
    // a message that is not startable is answered with nothing, not with a limit error
    msg(M4, { status: "draft" }),
    scalar("draft_with_limit_reached", sel(call.start(M4, A2))),
  ].join("\n");
  const r = replay0265(body);
  const overall = replay0265(
    [
      FIXTURES,
      OPERATORS,
      FLAGS_ON,
      ...Array.from({ length: 9 }, (_, i) => sent(i + 1, null, "3 hours")),
      msg(M1, { by: A3, status: "prepared", approval: false }),
      scalar("tenth_starts", `select (${call.start(M1, A3)} = '${M1}')::text`),
      msg(M2, { by: A2, status: "prepared", approval: false }),
      probe("eleventh_refused", sel(call.start(M2, A2)), "P0001", "overall_daily_limit"),
    ].join("\n"),
  );
  // ten starts that began 30 hours ago do not hold anything back
  const overallOld = replay0265(
    [FIXTURES, OPERATORS, FLAGS_ON, ...Array.from({ length: 10 }, (_, i) => sent(i + 1, null, "30 hours")), msg(M1, { by: A3, status: "prepared", approval: false }), scalar("old_overall_do_not_count", `select (${call.start(M1, A3)} = '${M1}')::text`)].join("\n"),
  );
  const rolling = replay0265(
    [FIXTURES, OPERATORS, FLAGS_ON, ...Array.from({ length: 5 }, (_, i) => sent(i + 1, A2, "24 hours 1 minute")), msg(M1, { status: "prepared", approval: false }), scalar("old_do_not_count", `select (${call.start(M1, A2)} = '${M1}')::text`)].join("\n"),
  );

  it("the replays apply", () => {
    for (const x of [r, overall, rolling]) expect(x.ok, x.stderr).toBe(true);
  });
  it("a sixth start by one creator inside 24 hours is refused with operator_daily_limit and the message stays unstarted; the fifth is allowed; another creator is not held", () => {
    expect(r.res.fifth_starts).toBe("true");
    expect(r.res.sixth_refused).toBe("ok");
    expect(r.res.sixth_state).toMatch(/^prepared\/none$/);
    expect(r.res.other_creator_starts).toBe("true");
  });
  it("a message that is not startable gets null, not a limit error", () => expect(r.res.draft_with_limit_reached).toBe("NULL"));
  it("an eleventh start overall inside 24 hours is refused with overall_daily_limit; the tenth is allowed", () => {
    expect(overall.res.tenth_starts).toBe("true");
    expect(overall.res.eleventh_refused).toBe("ok");
  });
  it("starts older than 24 hours do not count (a rolling window), for the creator and overall", () => {
    expect(rolling.res.old_do_not_count).toBe("true");
    expect(overallOld.ok, overallOld.stderr).toBe(true);
    expect(overallOld.res.old_overall_do_not_count).toBe("true");
  });
});

describe("start_admin_message_send: a flag stop is recorded once per message until something else happens to it (F8)", () => {
  const stops = (m: string) => `select count(*) from public.admin_message_events where message_id = '${m}' and event = 'flag_stopped'`;
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    msg(M1, { status: "approved", approval: false }),
    flag("admin_messaging", false),
    `select ${call.start(M1, A2)};`,
    `select ${call.start(M1, A2)};`,
    `select ${call.start(M1, A3)};`,
    scalar("after_three_calls", stops(M1)),
    // another message has its own stop
    msg(M2, { status: "approved", approval: false }),
    `select ${call.start(M2, A2)};`,
    scalar("other_message", stops(M2)),
    // something else happened to a message after its last stop (a dated event) and the flag is still off: one more stop is recorded, once
    msg(M3, { status: "approved", approval: false }),
    `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email, at) values ('${M3}', 'flag_stopped', '${A2}', 'a@example.test', now() - interval '2 minutes'), ('${M3}', 'test_sent', '${A2}', 'a@example.test', now() - interval '1 minute');`,
    `select ${call.start(M3, A2)};`,
    `select ${call.start(M3, A2)};`,
    scalar("after_a_later_event", stops(M3)),
    // an unknown message writes nothing
    probe("unknown_message", sel(call.start(UNKNOWN, A2)), "P0001", "not_found"),
    scalar("no_orphan_events", "select count(*) from public.admin_message_events where message_id is null"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("repeated starts with a flag off write one flag_stopped event per message, not one per call", () => {
    expect([r.res.after_three_calls, r.res.other_message]).toEqual(["1", "1"]);
  });
  it("a new stop is recorded once something else has happened to the message since", () => expect(r.res.after_a_later_event).toBe("2"));
  it("an unknown message writes no event", () => expect([r.res.unknown_message, r.res.no_orphan_events]).toEqual(["ok", "0"]));
});

describe("resolve_stale_claim: only an e-mail claim open longer than the stale age (30 minutes) (F6)", () => {
  const S = (n: number) => `00000000-0000-4000-8000-0000000fa${String(n).padStart(3, "0")}`;
  const claim = (n: number, channel: string, ago: string) =>
    `insert into public.notification_deliveries (id, user_id, kind, subject_id, channel, claimed_at) values ('${S(n)}', '${U1}', 'match_alert', '${S(n + 50)}', '${channel}', now() - interval '${ago}');`;
  const resolve = (n: number, how: string) => `public.resolve_stale_claim(p_id => '${S(n)}', p_actor => '${A2}', p_resolution => '${how}')`;
  const body = [
    FIXTURES,
    OPERATORS,
    claim(1, "email", "31 minutes"),
    claim(2, "email", "29 minutes 30 seconds"),
    claim(3, "push", "5 hours"),
    claim(4, "inapp", "5 hours"),
    claim(5, "email", "2 hours"),
    probe("fresh_email_refused", sel(resolve(2, "mark_sent")), "P0001", "invalid_state"),
    probe("old_push_refused", sel(resolve(3, "release_for_retry")), "P0001", "invalid_state"),
    probe("old_inapp_refused", sel(resolve(4, "mark_sent")), "P0001", "invalid_state"),
    scalar("refusals_changed_nothing", `select count(*) from public.notification_deliveries where id in ('${S(2)}', '${S(3)}', '${S(4)}') and sent_at is null and released_at is null`),
    scalar("refusals_wrote_no_event", "select count(*) from public.admin_message_events where event = 'claim_resolved'"),
    `select ${resolve(1, "mark_sent")};`,
    `select ${resolve(5, "release_for_retry")};`,
    scalar("old_email_resolved", `select (select sent_at is not null from public.notification_deliveries where id = '${S(1)}')::text || '/' || (select released_at is not null from public.notification_deliveries where id = '${S(5)}')::text`),
    scalar("events", "select count(*) from public.admin_message_events where event = 'claim_resolved'"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a fresh e-mail claim, an old push claim and an old in-app claim are refused (invalid_state) and nothing changes", () => {
    for (const k of ["fresh_email_refused", "old_push_refused", "old_inapp_refused"]) expect(r.res[k], k).toBe("ok");
    expect([r.res.refusals_changed_nothing, r.res.refusals_wrote_no_event]).toEqual(["3", "0"]);
  });
  it("an e-mail claim older than 30 minutes can be marked sent or released, and each writes one event", () => {
    expect(r.res.old_email_resolved).toBe("true/true");
    expect(r.res.events).toBe("2");
  });
});
