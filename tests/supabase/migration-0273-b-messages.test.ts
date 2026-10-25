/**
 * 0273 (N1B) part B, the admin-message functions, replayed CUMULATIVELY (0265 then 0273):
 *   F8  a flag stop records WHICH flags were off, as a bitmask 1..15 (master 1, messaging 2, promotions 4, e-mail 8; only flags that matter for the message count); one event per message per
 *       state, a different state is a new event; two sessions asking at once write one
 *   the daily limit counts by the creator's address (lower-cased), so an admin who was deleted or re-created does not reset it, at prepare and at start
 *   an admin deleted while a message of theirs is sending changes that message's creator id to null and nothing else
 *   a person's deletion still removes their recipient rows although the service role cannot delete them
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { A1, A2, FIXTURES, M1, M2, U1, U2, probe, replay0265, rowsOf, scalar } from "./migration-0265-support";
import { A3, A4, FLAGS_ON, M3, M4, M5, OPERATORS, call, flag, msg, sel } from "./migration-0265-admin-support";

const states = (m: string) => `select coalesce(string_agg(coalesce(flag_state::text, 'null'), ',' order by at, id), 'none') from public.admin_message_events where message_id = '${m}' and event = 'flag_stopped'`;
const start = (m: string, actor = A2) => `select ${call.start(m, actor)};`;

describe("F8: the flag_state column", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    msg(M1),
    scalar("type", "select data_type || '/' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'admin_message_events' and column_name = 'flag_state'"),
    ...[0, 16, -1, 100].map((v) => probe(`bad_${v}`, `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email, flag_state) values ('${M1}', 'flag_stopped', '${A2}', 'a@example.test', ${v})`, "23514")),
    ...[1, 7, 15].map((v) => rowsOf(`good_${v}`, `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email, flag_state) values ('${M1}', 'flag_stopped', '${A2}', 'a@example.test', ${v})`)),
    rowsOf("null_for_old_events", `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values ('${M1}', 'flag_stopped', '${A2}', 'a@example.test')`),
    scalar("check_name", "select count(*) from pg_constraint where conrelid = 'public.admin_message_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%flag_state%'"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("it is a nullable smallint (old events carry null)", () => expect(r.res.type).toBe("smallint/YES"));
  it("a value outside 1..15 is refused with 23514; 1, 7 and 15 and null are accepted", () => {
    for (const v of [0, 16, -1, 100]) expect(r.res[`bad_${v}`], String(v)).toBe("ok");
    for (const v of [1, 7, 15]) expect(r.res[`good_${v}`], String(v)).toBe("1");
    expect(r.res.null_for_old_events).toBe("1");
    expect(r.res.check_name).toBe("1");
  });
});

describe("F8: start_admin_message_send records the stop once per message AND per set of flags that were off", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    // an announcement by in-app only: promotions and e-mail flags do not matter to it
    msg(M1, { status: "approved", approval: false }),
    flag("admin_messaging", false),
    start(M1), start(M1), start(M1, A3),
    scalar("messaging_off", states(M1)),
    flag("admin_promotions", false),
    flag("admin_email", false),
    start(M1),
    scalar("irrelevant_flags_add_nothing", states(M1)),
    flag("notifications_master", false),
    start(M1), start(M1),
    scalar("master_too", states(M1)),
    flag("admin_messaging", true),
    start(M1),
    scalar("only_master", states(M1)),
    // back to the earlier state after a change: a new event (the stop is per change of state, not per distinct value ever seen)
    flag("admin_messaging", false),
    start(M1),
    scalar("back_to_three", states(M1)),
    flag("notifications_master", true),
    flag("admin_messaging", true),
    scalar("started", `select ${call.start(M1, A2)}`),
    scalar("send_started_event", `select count(*) from public.admin_message_events where message_id = '${M1}' and event = 'send_started'`),
    scalar("stops_total", `select count(*) from public.admin_message_events where message_id = '${M1}' and event = 'flag_stopped'`),
    // a promotion by e-mail and in-app: all four flags matter
    FLAGS_ON,
    msg(M2, { status: "approved", approval: false, kind: "promotion", channels: "array['inapp','email']" }),
    flag("notifications_master", false), flag("admin_messaging", false), flag("admin_promotions", false), flag("admin_email", false),
    start(M2),
    scalar("all_four", states(M2)),
    flag("admin_promotions", true),
    start(M2),
    flag("admin_email", true),
    start(M2),
    scalar("walk_down", states(M2)),
    // a promotion without e-mail: the e-mail flag does not count
    FLAGS_ON,
    msg(M3, { status: "approved", approval: false, kind: "promotion" }),
    flag("admin_promotions", false), flag("admin_email", false),
    start(M3),
    scalar("promotion_no_email", states(M3)),
    // an announcement with e-mail: the promotions flag does not count
    FLAGS_ON,
    msg(M4, { status: "approved", approval: false, channels: "array['email']" }),
    flag("admin_promotions", false), flag("admin_email", false),
    start(M4),
    scalar("announcement_with_email", states(M4)),
    // a message that is not startable is still asked about with a flag off: the stop is recorded (as before)
    // an event written before N1B has no state: the next stop is recorded once, with a state, and then it holds
    FLAGS_ON,
    msg(M5, { status: "approved", approval: false }),
    `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email, at) values ('${M5}', 'flag_stopped', '${A2}', 'a@example.test', now() - interval '1 minute');`,
    flag("admin_messaging", false),
    start(M5), start(M5),
    scalar("after_an_old_event", states(M5)),
    // the other events in between: a stop after something else happened is a new event even with the same state
    `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email, at) values ('${M5}', 'test_sent', '${A2}', 'a@example.test', clock_timestamp());`,
    start(M5),
    start(M5), start(M5),
    scalar("after_something_else", states(M5)),
    // the events carry the stopper
    scalar("actor_kept", `select count(*) from public.admin_message_events where message_id = '${M5}' and event = 'flag_stopped' and actor_admin_id = '${A2}' and flag_state is not null`),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("one stop per message while the same flags are off, whoever asks", () => expect(r.res.messaging_off).toBe("2"));
  it("flags that do not matter for the message add no stop and no bit", () => expect(r.res.irrelevant_flags_add_nothing).toBe("2"));
  it("another flag going off is a new stop with both bits; the other one coming back on is another", () => {
    expect(r.res.master_too).toBe("2,3");
    expect(r.res.only_master).toBe("2,3,1");
    expect(r.res.back_to_three).toBe("2,3,1,3");
  });
  it("with everything back on the message starts; no stop is written for it", () => {
    expect(r.res.started).toBe(r.res.started.length === 36 ? r.res.started : "uuid");
    expect(r.res.send_started_event).toBe("1");
    expect(r.res.stops_total).toBe("4");
  });
  it("a promotion by e-mail counts all four flags: 15, and each flag coming back changes the state", () => {
    expect(r.res.all_four).toBe("15");
    expect(r.res.walk_down).toBe("15,11,3");
  });
  it("the e-mail flag does not count for a message without e-mail, the promotions flag not for an announcement", () => {
    expect(r.res.promotion_no_email).toBe("4");
    expect(r.res.announcement_with_email).toBe("8");
  });
  it("an event from before N1B has no state: the next stop is recorded once with a state; something else in between makes the next one new", () => {
    expect(r.res.after_an_old_event).toBe("null,2");
    expect(r.res.after_something_else).toBe("null,2,2");
    expect(r.res.actor_kept).toBe("2");
  });
});

describe("the daily limit counts by the creator's address, lower-cased, so a deleted or re-created admin does not reset it", () => {
  const sent = (id: string, o: { by?: string | null; email: string }) => msg(id, { ...o, status: "sent", approval: false, started: "1 hour" });
  const idn = (n: number) => `00000000-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`;
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    // five sends by A3, the first two written with a differently cased address
    sent(idn(1), { by: A3, email: `${A3.toUpperCase()}@EXAMPLE.TEST` }),
    sent(idn(2), { by: A3, email: `${A3}@Example.Test` }),
    sent(idn(3), { by: A3, email: `${A3}@example.test` }),
    sent(idn(4), { by: A3, email: `${A3}@example.test` }),
    sent(idn(5), { by: A3, email: `${A3}@example.test` }),
    msg(M3, { by: A3, status: "approved", approval: false }),
    // the admin is deleted: the creator ids go to null, the addresses stay
    rowsOf("delete_admin", `delete from public.admin_users where id = '${A3}'`),
    scalar("ids_cleared", "select count(*) from public.admin_messages where created_by is null"),
    probe("start_after_deletion", sel(call.start(M3, A2)), "P0001", "operator_daily_limit"),
    scalar("still_approved", `select status from public.admin_messages where id = '${M3}'`),
    // another creator is not held by it
    msg(M4, { by: A4, status: "approved", approval: false }),
    scalar("other_creator", `select (${call.start(M4, A2)} = '${M4}')::text`),
    // at prepare the count is by the ACTING admin's address: five sends under A2's address whose creator id is gone
    ...[11, 12, 13, 14, 15].map((n) => sent(idn(n), { by: null, email: `${A2}@Example.Test` })),
    msg(M1, { by: A2, key: "self_test" }),
    probe("prepare_by_address", sel(call.prepare(M1, A2)), "P0001", "operator_daily_limit"),
    scalar("still_draft", `select status from public.admin_messages where id = '${M1}'`),
    msg(M2, { by: A1, key: "self_test" }),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the fixtures: the admin's deletion cleared the creator ids and kept their addresses", () => {
    expect(r.res.delete_admin).toBe("1");
    expect(r.res.ids_cleared).toBe("6");
  });
  it("a sixth start by a creator whose admin row is gone is refused (any letter case), and the message stays approved", () => {
    expect(r.res.start_after_deletion).toBe("ok");
    expect(r.res.still_approved).toBe("approved");
  });
  it("another creator is not held by it", () => expect(r.res.other_creator).toBe("true"));
  it("a prepare by an admin whose address already has five sends is refused, whatever the creator ids say", () => {
    expect(r.res.prepare_by_address).toBe("ok");
    expect(r.res.still_draft).toBe("draft");
  });
});

describe("an admin deleted while a message of theirs is sending", () => {
  const snapshot = (m: string) => `select md5((to_jsonb(x) - 'created_by')::text) from public.admin_messages x where x.id = '${m}'`;
  const body = [
    FIXTURES,
    OPERATORS,
    msg(M3, { by: A3, status: "sending", approval: false, started: "5 minutes" }),
    `update public.admin_messages set sent_count = 4, failed_count = 1, skipped_count = 2 where id = '${M3}';`,
    `create temp table n1_before as ${snapshot(M3)};`,
    scalar("creator_before", `select created_by from public.admin_messages where id = '${M3}'`),
    // the creator id may be cleared and ONLY that: not together with a content or address change
    probe("null_creator_with_title", `update public.admin_messages set created_by = null, title = 'Other' where id = '${M3}'`, "P0001", "invalid_state"),
    probe("null_creator_with_address", `update public.admin_messages set created_by = null, created_by_email = 'x@example.test' where id = '${M3}'`, "P0001", "invalid_state"),
    probe("another_creator", `update public.admin_messages set created_by = '${A2}' where id = '${M3}'`, "P0001", "invalid_state"),
    rowsOf("delete_admin", `delete from public.admin_users where id = '${A3}'`),
    scalar("creator_after", `select coalesce(created_by::text, 'NULL') from public.admin_messages where id = '${M3}'`),
    scalar("nothing_else_changed", `select ((select md5 from n1_before) = (${snapshot(M3)}))::text`),
    scalar("status_and_counters", `select status || '/' || sent_count || '/' || failed_count || '/' || skipped_count from public.admin_messages where id = '${M3}'`),
    // the send carries on: it can still be finished
    `select public.finish_admin_message_send(p_message => '${M3}');`,
    scalar("final_status", `select status from public.admin_messages where id = '${M3}'`),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("created_by becomes null and nothing else on the row changes", () => {
    expect(r.res.creator_before).toBe(A3);
    expect([r.res.null_creator_with_title, r.res.null_creator_with_address, r.res.another_creator]).toEqual(["ok", "ok", "ok"]);
    expect(r.res.delete_admin).toBe("1");
    expect(r.res.creator_after).toBe("NULL");
    expect(r.res.nothing_else_changed).toBe("true");
    expect(r.res.status_and_counters).toBe("sending/4/1/2");
  });
  it("the send can still be finished afterwards", () => expect(r.res.final_status).toBe("sent"));
});

describe("a person's deletion removes their recipient rows although the service role cannot delete recipient rows", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    msg(M3, { status: "sending", approval: false, started: "5 minutes" }),
    `insert into public.admin_message_recipients (message_id, user_id, to_inapp) values ('${M3}', '${U1}', true), ('${M3}', '${U2}', true);`,
    scalar("service_role_can_delete", "select has_table_privilege('service_role', 'public.admin_message_recipients', 'DELETE')::text"),
    scalar("before", `select count(*) from public.admin_message_recipients where message_id = '${M3}'`),
    rowsOf("delete_person", `delete from auth.users where id = '${U1}'`),
    scalar("after", `select count(*) from public.admin_message_recipients where message_id = '${M3}'`),
    scalar("other_person_kept", `select count(*) from public.admin_message_recipients where message_id = '${M3}' and user_id = '${U2}'`),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the service role has no DELETE on recipients, yet deleting the person removes their rows and only theirs", () => {
    expect(r.res.service_role_can_delete).toBe("false");
    expect([r.res.before, r.res.delete_person, r.res.after, r.res.other_person_kept]).toEqual(["2", "1", "1", "1"]);
  });
});
