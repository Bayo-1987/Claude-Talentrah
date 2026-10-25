/**
 * 0273 (N1B) part A, replayed CUMULATIVELY (0265 then 0273) in a private scratch database in rolled-back transactions:
 *   F2  create_admin_message is the only way to make a message, and the approver is not the creator nor the actor of the `created` event
 *   F3  the service role writes messages, audit rows and recipients only through functions; the edit guard enforces the legal status graph and freezes the approval fields; every admin function
 *       runs as service_role; the two sender functions
 *   the ledger: the service role reads it and writes it only through the claim functions
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { A1, A2, D1, FIXTURES, M1, M2, U1, asRole, deviceSql, probe, replay0265, rowsOf, scalar } from "./migration-0265-support";
import { A3, A4, FLAGS_ON, M3, M4, OPERATORS, msg, sel } from "./migration-0265-admin-support";

const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
const create = (actor: string | null, over: Partial<Record<"kind" | "title" | "channels" | "key" | "link" | "consent" | "req", string | null>> = {}) =>
  `public.create_admin_message(p_actor => ${lit(actor)}, p_kind => ${lit("kind" in over ? over.kind! : "service_announcement")}, p_title => ${lit("title" in over ? over.title! : "Title")}, p_body => 'Body', p_link_path => ${lit("link" in over ? over.link! : null)}, p_channels => ${over.channels ?? "array['inapp']"}, p_segment_key => ${lit(over.key ?? "self_test")}, p_segment_params => '{}'::jsonb, p_consent_line => ${lit("consent" in over ? over.consent! : null)}${over.req ? `, p_requires_approval => ${over.req}` : ""})`;
/** A message id held in a temp table, for messages the functions made themselves. */
const IDS = "create temp table n1_ids (k text primary key, id uuid);";
const mk = (k: string, expr: string) => `insert into n1_ids select '${k}', ${expr};`;
const id = (k: string) => `(select id from n1_ids where k = '${k}')`;

describe("F2: create_admin_message sets the creator itself, and approval needs someone else than that creator", () => {
  const FORGED = "00000000-0000-4000-8000-0000000fc0f1";
  const NOCREATOR = "00000000-0000-4000-8000-0000000fc0f2";
  const NOCREATOR_EVENT = "00000000-0000-4000-8000-0000000fc0f3";
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    IDS,
    mk("m1", create(A2)),
    scalar("made_row", `select created_by || '/' || created_by_email || '/' || status || '/' || requires_approval::text from public.admin_messages where id = ${id("m1")}`),
    scalar("created_event", `select count(*) || '/' || min(actor_admin_id::text) || '/' || min(actor_email) from public.admin_message_events where message_id = ${id("m1")} and event = 'created'`),
    probe("no_permission", sel(create(A1)), "42501"),
    probe("null_actor", sel(create(null)), "42501"),
    probe("operators_only_holder", sel(create(A4)), "42501"),
    probe("bad_kind", sel(create(A2, { kind: "newsletter" })), "22023"),
    probe("null_title", sel(create(A2, { title: null })), "22023"),
    probe("bad_link", sel(create(A2, { link: "//evil.example" })), "22023"),
    scalar("bad_value_error_text", `select pg_temp.errtext('select ${create(A2, { kind: "leaky-kind-value" }).replace(/'/g, "''")}')`),
    scalar("function_args", "select pg_get_function_arguments(p.oid) from pg_proc p where p.proname = 'create_admin_message' and p.pronamespace = 'public'::regnamespace"),
    // A2 created m1. A3 prepares and submits it, then approves it: allowed (the preparer and the submitter are not excluded)
    `select public.prepare_admin_message(${id("m1")}, '${A3}', 500);`,
    `select public.submit_admin_message(${id("m1")}, '${A3}');`,
    probe("creator_cannot_approve", `select public.approve_admin_message(${id("m1")}, '${A2}', 'service_announcement')`, "P0001", "self_approval"),
    `select public.approve_admin_message(${id("m1")}, '${A3}', 'service_announcement');`,
    scalar("preparer_and_submitter_may_approve", `select status || '/' || approved_by from public.admin_messages where id = ${id("m1")}`),
    // a row whose created_by was written by hand (a forged creator): the `created` event still names the real creator
    msg(FORGED, { by: A3, status: "submitted", approval: true }),
    `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values ('${FORGED}', 'created', '${A2}', 'a2@example.test');`,
    probe("forged_creator_cannot_approve_as_event_actor", `select public.approve_admin_message('${FORGED}', '${A2}', 'service_announcement')`, "P0001", "self_approval"),
    probe("row_creator_cannot_approve", `select public.approve_admin_message('${FORGED}', '${A3}', 'service_announcement')`, "P0001", "self_approval"),
    // a message with no creator on the row
    msg(NOCREATOR, { by: null, status: "submitted", approval: true }),
    probe("no_creator_and_no_created_event_is_refused", `select public.approve_admin_message('${NOCREATOR}', '${A3}', 'service_announcement')`, "P0001", "self_approval"),
    msg(NOCREATOR_EVENT, { by: null, status: "submitted", approval: true }),
    `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values ('${NOCREATOR_EVENT}', 'created', '${A2}', 'a2@example.test');`,
    probe("no_creator_row_but_created_event_creator_cannot_approve", `select public.approve_admin_message('${NOCREATOR_EVENT}', '${A2}', 'service_announcement')`, "P0001", "self_approval"),
    `select public.approve_admin_message('${NOCREATOR_EVENT}', '${A3}', 'service_announcement');`,
    scalar("no_creator_row_other_admin_approves", `select status from public.admin_messages where id = '${NOCREATOR_EVENT}'`),
    // the function takes no created_by: a direct insert by the service role is closed (see F3)
    asRole("service_role", [probe("service_role_insert_closed", `insert into public.admin_messages (created_by, created_by_email, kind, title, body, channels, segment_key) values ('${A3}', 'x@example.test', 'service_announcement', 't', 'b', array['inapp'], 'self_test')`, "42501")]),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a message made by the function has the caller as creator, their address, status draft, approval required, and one `created` event naming them", () => {
    expect(r.res.made_row).toBe(`${A2}/${A2}@example.test/draft/true`);
    expect(r.res.created_event).toBe(`1/${A2}/${A2}@example.test`);
  });
  it("no permission, no actor and a holder of only the operators permission are 42501; a bad kind, a missing title and a bad link are 22023, and the error carries no value", () => {
    for (const k of ["no_permission", "null_actor", "operators_only_holder", "bad_kind", "null_title", "bad_link"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.bad_value_error_text).toBe("invalid parameter");
  });
  it("the function has no created_by argument (the creator cannot be named by the caller)", () => expect(r.res.function_args).not.toMatch(/created_by/i));
  it("the creator cannot approve their own message; the preparer and the submitter (another operator) can", () => {
    expect(r.res.creator_cannot_approve).toBe("ok");
    expect(r.res.preparer_and_submitter_may_approve).toBe(`approved/${A3}`);
  });
  it("the actor of the `created` event cannot approve even when the row names someone else (a forged created_by); the row's creator cannot either", () => {
    expect(r.res.forged_creator_cannot_approve_as_event_actor).toBe("ok");
    expect(r.res.row_creator_cannot_approve).toBe("ok");
  });
  it("a message with no creator on the row and no `created` event cannot be approved by anyone; with the event, anyone but its actor can", () => {
    expect(r.res.no_creator_and_no_created_event_is_refused).toBe("ok");
    expect(r.res.no_creator_row_but_created_event_creator_cannot_approve).toBe("ok");
    expect(r.res.no_creator_row_other_admin_approves).toBe("approved");
  });
  it("the service role cannot insert a message by table", () => expect(r.res.service_role_insert_closed).toBe("ok"));
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
describe("F3: the legal status graph, every move with the function that makes it", () => {
  const STATES = ["draft", "prepared", "submitted", "approved", "sending", "sent", "cancelled", "paused_email_cap", "paused_email_ceiling"] as const;
  const LEGAL = new Set([
    "draft>prepared", "prepared>submitted", "submitted>approved", "approved>sending", "prepared>sending", "sending>paused_email_cap", "sending>paused_email_ceiling",
    "paused_email_cap>sending", "paused_email_ceiling>sending", "sending>sent",
    "draft>cancelled", "prepared>cancelled", "submitted>cancelled", "approved>cancelled", "paused_email_cap>cancelled", "paused_email_ceiling>cancelled",
  ]);
  const pairs = STATES.flatMap((from) => STATES.filter((to) => to !== from).map((to) => [from, to] as const));
  const idn = (i: number) => `00000000-0000-4000-8000-0000000fd${String(i).padStart(3, "0")}`;
  const body = [
    FIXTURES,
    OPERATORS,
    ...pairs.map(([from], i) => msg(idn(i), { status: from, approval: false })),
    // prepared WITH a required approval cannot go to sending
    msg("00000000-0000-4000-8000-0000000fd900", { status: "prepared", approval: true }),
    ...pairs.map(([, to], i) => probe(`m${i}`, `update public.admin_messages set status = '${to}' where id = '${idn(i)}'`, "P0001", "invalid_state")),
    probe("prepared_needing_approval_to_sending", "update public.admin_messages set status = 'sending' where id = '00000000-0000-4000-8000-0000000fd900'", "P0001", "invalid_state"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it.each(pairs.map(([f, t], i) => [`${f} to ${t}`, i, LEGAL.has(`${f}>${t}`)] as const))("%s: %s", (_n, i, legal) => {
    // probe answers "ok" when the update is REFUSED with invalid_state, and "NOT REFUSED" when it succeeded
    expect(r.res[`m${i}`]).toBe(legal ? "NOT REFUSED" : "ok");
  });
  it("prepared to sending is refused while the message still requires approval", () => expect(r.res.prepared_needing_approval_to_sending).toBe("ok"));
});

describe("F3: frozen fields, counters and the start time", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    msg(M1, { status: "prepared", approval: true }),
    msg(M2, { status: "sending", approval: false, started: "1 minute" }),
    msg(M3, { status: "draft", approval: false }),
    // once past draft, who made it and who approved it are not rewritten
    probe("created_by_email", `update public.admin_messages set created_by_email = 'x@example.test' where id = '${M1}'`, "P0001", "invalid_state"),
    probe("created_by_other", `update public.admin_messages set created_by = '${A3}' where id = '${M1}'`, "P0001", "invalid_state"),
    probe("approved_by_outside_approval", `update public.admin_messages set approved_by = '${A3}' where id = '${M1}'`, "P0001", "invalid_state"),
    probe("approved_by_email_outside_approval", `update public.admin_messages set approved_by_email = 'x@example.test' where id = '${M1}'`, "P0001", "invalid_state"),
    probe("confirmation_outside_approval", `update public.admin_messages set kind_confirmed_by_approver = 'service_announcement' where id = '${M1}'`, "P0001", "invalid_state"),
    // the approval requirement and the frozen audience
    probe("requires_approval_lowered", `update public.admin_messages set requires_approval = false where id = '${M1}'`, "P0001", "invalid_state"),
    probe("audience_changed_after_prepare", `update public.admin_messages set audience_count = 99 where id = '${M1}'`, "P0001", "invalid_state"),
    rowsOf("draft_may_set_requires_approval", `update public.admin_messages set requires_approval = true where id = '${M3}'`),
    rowsOf("draft_to_prepared_may_raise_it", `update public.admin_messages set status = 'prepared', requires_approval = true, audience_count = 4 where id = '${M3}'`),
    // counters: only while a send runs, never down
    probe("counters_in_prepared", `update public.admin_messages set sent_count = 1 where id = '${M1}'`, "P0001", "invalid_state"),
    rowsOf("counters_up_while_sending", `update public.admin_messages set sent_count = 3, failed_count = 1 where id = '${M2}'`),
    probe("counter_down", `update public.admin_messages set sent_count = 2 where id = '${M2}'`, "P0001", "invalid_state"),
    // the start time
    probe("start_time_rewritten", `update public.admin_messages set sent_started_at = now() where id = '${M2}'`, "P0001", "invalid_state"),
    // an admin's deletion clears the id and keeps the snapshot (R22): the foreign key's own update passes the guard
    msg(M4, { status: "approved", approval: false, by: A4 }),
    rowsOf("delete_admin", `delete from public.admin_users where id = '${A4}'`),
    scalar("creator_cleared", `select coalesce(created_by::text, 'NULL') || '/' || created_by_email from public.admin_messages where id = '${M4}'`),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("creator, creator address, approver, approver address and confirmation cannot be rewritten outside the approving move", () => {
    for (const k of ["created_by_email", "created_by_other", "approved_by_outside_approval", "approved_by_email_outside_approval", "confirmation_outside_approval"]) expect(r.res[k], k).toBe("ok");
  });
  it("the approval requirement cannot be lowered and the audience cannot change after prepare; a draft may set them, and the move into prepared may raise the requirement", () => {
    expect([r.res.requires_approval_lowered, r.res.audience_changed_after_prepare]).toEqual(["ok", "ok"]);
    expect([r.res.draft_may_set_requires_approval, r.res.draft_to_prepared_may_raise_it]).toEqual(["1", "1"]);
  });
  it("counters change only while a send is running, and never go down", () => {
    expect([r.res.counters_in_prepared, r.res.counters_up_while_sending, r.res.counter_down]).toEqual(["ok", "1", "ok"]);
  });
  it("the start time is written once", () => expect(r.res.start_time_rewritten).toBe("ok"));
  it("deleting the admin clears created_by and keeps the e-mail snapshot", () => {
    expect(r.res.delete_admin).toBe("1");
    expect(r.res.creator_cleared).toBe(`NULL/${A4}@example.test`);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
describe("F3: the service role writes nothing by table, and every admin function runs as the service role", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    IDS,
    deviceSql(D1, U1),
    "grant all on n1_ids to service_role;",
    msg(M1, { status: "prepared", approval: false }),
    `insert into public.admin_message_recipients (message_id, user_id, to_email) values ('${M1}', '${U1}', true);`,
    `insert into public.admin_message_events (message_id, event) values ('${M1}', 'prepared');`,
    asRole("service_role", [
      probe("insert_message", "insert into public.admin_messages (kind, title, body, channels, segment_key, created_by_email) values ('service_announcement', 't', 'b', array['inapp'], 'self_test', 'x@example.test')", "42501"),
      probe("update_status", `update public.admin_messages set status = 'approved' where id = '${M1}'`, "42501"),
      probe("update_requires_approval", `update public.admin_messages set requires_approval = false where id = '${M1}'`, "42501"),
      probe("update_sent_count", `update public.admin_messages set sent_count = 5 where id = '${M1}'`, "42501"),
      probe("delete_message", `delete from public.admin_messages where id = '${M1}'`, "42501"),
      probe("insert_event", `insert into public.admin_message_events (message_id, event) values ('${M1}', 'approved')`, "42501"),
      probe("insert_recipient", `insert into public.admin_message_recipients (message_id, user_id) values ('${M1}', '${U1}')`, "42501"),
      probe("delete_recipient", `delete from public.admin_message_recipients where message_id = '${M1}'`, "42501"),
      probe("update_recipient_flag", `update public.admin_message_recipients set to_push = true where message_id = '${M1}'`, "42501"),
      rowsOf("update_recipient_outcomes", `update public.admin_message_recipients set push_outcome = 'sent', email_outcome = 'failed' where message_id = '${M1}'`),
      rowsOf("service_reads_message", `select * from public.admin_messages where id = '${M1}'`),
      rowsOf("service_reads_events", "select * from public.admin_message_events"),
      rowsOf("service_reads_recipients", "select * from public.admin_message_recipients"),
    ]),
    scalar("recipient_outcomes", `select push_outcome || '/' || email_outcome from public.admin_message_recipients where message_id = '${M1}'`),
    // EVERY admin function, called as the service role, does its whole job (the writes happen as the function's owner)
    asRole("service_role", [
      mk("m", create(A2, { key: "everyone", channels: "array['inapp','push','email']" })),
      `select public.prepare_admin_message(${id("m")}, '${A3}', 500);`,
      `select public.submit_admin_message(${id("m")}, '${A2}');`,
      `select public.approve_admin_message(${id("m")}, '${A3}', 'service_announcement');`,
      `select public.record_admin_message_test(${id("m")}, '${A2}');`,
      `select public.start_admin_message_send(${id("m")}, '${A2}');`,
      `select public.record_admin_message_progress(${id("m")}, 2, 1, 1);`,
      `select public.pause_admin_message_send(${id("m")}, 'cap_24h');`,
      `select public.resume_admin_message_send(${id("m")}, '${A2}');`,
      `select public.finish_admin_message_send(${id("m")});`,
      mk("c", create(A2)),
      `select public.cancel_admin_message(${id("c")}, '${A3}');`,
      `select public.set_notification_setting('mass_email_cap_24h', 60, '${A4}');`,
      rowsOf("audit_rows", `select * from public.admin_message_audit('${A2}', ${id("m")})`),
      rowsOf("segment_rows", "select * from public.resolve_admin_segment('self_test', '{}'::jsonb, '" + A2 + "')"),
      rowsOf("eligible_rows", `select * from public.admin_email_eligible_recipients(array['${U1}']::uuid[], 'announcements')`),
    ]),
    scalar("walk_states", `select string_agg(event, ',' order by at, event) from public.admin_message_events where message_id = ${id("m")}`),
    scalar("final_status", `select status || '/' || sent_count || '/' || failed_count || '/' || skipped_count from public.admin_messages where id = ${id("m")}`),
    scalar("cancelled", `select status from public.admin_messages where id = ${id("c")}`),
    scalar("setting", "select int_value from public.notification_settings where key = 'mass_email_cap_24h'"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the service role cannot insert, update or delete messages, add audit rows, or add, delete or flag recipients by table (42501)", () => {
    for (const k of ["insert_message", "update_status", "update_requires_approval", "update_sent_count", "delete_message", "insert_event", "insert_recipient", "delete_recipient", "update_recipient_flag"]) expect(r.res[k], k).toBe("ok");
  });
  it("the service role still reads all three, and can set the two outcome columns of a recipient", () => {
    expect([r.res.service_reads_message, r.res.service_reads_events, r.res.service_reads_recipients]).toEqual(["1", "1", "1"]);
    expect(r.res.update_recipient_outcomes).toBe("1");
    expect(r.res.recipient_outcomes).toBe("sent/failed");
  });
  it("every admin function runs to its end as the service role: create, prepare, submit, approve, test, start, progress, pause, resume, finish, cancel, set a setting, audit, segment, eligibility", () => {
    expect(r.res.final_status).toBe("sent/2/1/1".replace("sent", "sent"));
    expect(r.res.cancelled).toBe("cancelled");
    expect(r.res.setting).toBe("60");
    expect(Number(r.res.audit_rows)).toBeGreaterThanOrEqual(8);
    expect(r.res.segment_rows).toBe("1");
    expect(r.res.eligible_rows).toBe("0");
    expect(r.res.walk_states.split(",")).toEqual(expect.arrayContaining(["created", "prepared", "submitted", "approved", "test_sent", "send_started", "resumed", "send_finished"]));
  });
});

describe("F3: the two sender functions", () => {
  const S = (k: string) => id(k);
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    IDS,
    mk("m", create(A2, { key: "everyone", channels: "array['inapp','email']", req: "false" })),
    `select public.prepare_admin_message(${S("m")}, '${A2}', 500);`,
    scalar("audience", `select audience_count from public.admin_messages where id = ${S("m")}`),
    probe("progress_in_prepared", `select public.record_admin_message_progress(${S("m")}, 1, 0, 0)`, "P0001", "invalid_state"),
    probe("finish_in_prepared", `select public.finish_admin_message_send(${S("m")})`, "P0001", "invalid_state"),
    `select public.start_admin_message_send(${S("m")}, '${A2}');`,
    probe("progress_unknown", "select public.record_admin_message_progress('00000000-0000-4000-8000-0000000000ee', 1, 0, 0)", "P0001", "not_found"),
    probe("finish_unknown", "select public.finish_admin_message_send('00000000-0000-4000-8000-0000000000ee')", "P0001", "not_found"),
    probe("progress_null", `select public.record_admin_message_progress(${S("m")}, null, 0, 0)`, "22023"),
    probe("progress_negative", `select public.record_admin_message_progress(${S("m")}, 1, -1, 0)`, "22023"),
    `select public.record_admin_message_progress(${S("m")}, 5, 2, 1);`,
    `select public.record_admin_message_progress(${S("m")}, 3, 0, 0);`,
    scalar("counts_add_up", `select sent_count || '/' || failed_count || '/' || skipped_count from public.admin_messages where id = ${S("m")}`),
    // the cap: audience times channels = 12 per counter
    probe("progress_over_the_cap", `select public.record_admin_message_progress(${S("m")}, 5, 0, 0)`, "22023"),
    `select public.record_admin_message_progress(${S("m")}, 4, 0, 0);`,
    scalar("at_the_cap", `select sent_count from public.admin_messages where id = ${S("m")}`),
    // paused: progress is still accepted, finish is not
    `select public.pause_admin_message_send(${S("m")}, 'ceiling_month');`,
    `select public.record_admin_message_progress(${S("m")}, 0, 1, 0);`,
    probe("finish_while_paused", `select public.finish_admin_message_send(${S("m")})`, "P0001", "invalid_state"),
    `select public.resume_admin_message_send(${S("m")}, '${A2}');`,
    `select public.finish_admin_message_send(${S("m")});`,
    scalar("finished", `select status from public.admin_messages where id = ${S("m")}`),
    scalar("finish_event", `select count(*) || '/' || coalesce(min(actor_admin_id::text), 'no-actor') from public.admin_message_events where message_id = ${S("m")} and event = 'send_finished'`),
    probe("progress_after_finish", `select public.record_admin_message_progress(${S("m")}, 1, 0, 0)`, "P0001", "invalid_state"),
    probe("finish_twice", `select public.finish_admin_message_send(${S("m")})`, "P0001", "invalid_state"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("progress is refused outside a running or paused send (invalid_state), for an unknown message (not_found), and for a null or negative value (22023)", () => {
    for (const k of ["progress_in_prepared", "finish_in_prepared", "progress_unknown", "finish_unknown", "progress_null", "progress_negative", "progress_after_finish", "finish_twice", "finish_while_paused"]) expect(r.res[k], k).toBe("ok");
  });
  it("progress adds to the counters, can never pass the audience times the channels, and is accepted while paused", () => {
    expect(r.res.audience).toBe("6");
    expect(r.res.counts_add_up).toBe("8/2/1");
    expect(r.res.progress_over_the_cap).toBe("ok");
    expect(r.res.at_the_cap).toBe("12");
  });
  it("finish moves sending to sent and writes one send_finished event with no actor", () => {
    expect(r.res.finished).toBe("sent");
    expect(r.res.finish_event).toBe("1/no-actor");
  });
});

describe("the ledger: the service role reads it and writes it only through the claim functions", () => {
  const CLAIM = "00000000-0000-4000-8000-0000000fc0c1";
  const SUBJECT = "00000000-0000-4000-8000-0000000fc0c2";
  const body = [
    FIXTURES,
    `insert into public.notification_deliveries (id, user_id, kind, subject_id, channel) values ('${CLAIM}', '${U1}', 'match_alert', '${SUBJECT}', 'inapp');`,
    asRole("service_role", [
      rowsOf("reads", "select * from public.notification_deliveries"),
      probe("insert", `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values ('${U1}', 'match_alert', gen_random_uuid(), 'inapp')`, "42501"),
      probe("update", `update public.notification_deliveries set sent_at = now() where id = '${CLAIM}'`, "42501"),
      probe("delete", "delete from public.notification_deliveries", "42501"),
      probe("truncate", "truncate public.notification_deliveries", "42501"),
      scalar("claims", `select (select c.refused is null from public.claim_notification(p_user => '${U1}', p_kind => 'match_alert', p_subject => gen_random_uuid(), p_channel => 'inapp') c)::text`),
      `select public.mark_notification_sent('${CLAIM}');`,
      scalar("marked", `select (sent_at is not null)::text from public.notification_deliveries where id = '${CLAIM}'`),
      scalar("released", `select (select count(*) from public.notification_deliveries) > 0`),
      `select public.prune_notification_deliveries(30);`,
      scalar("unread", `select public.unread_notification_count('${U1}')::text`),
      scalar("stale", "select count(*) from public.stale_notification_claims('email', interval '1 hour')"),
    ]),
    scalar("service_privileges", "select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('service_role', 'public.notification_deliveries', p)"),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the service role holds SELECT only, and insert, update, delete and truncate by table are 42501", () => {
    expect(r.res.service_privileges).toBe("SELECT");
    for (const k of ["insert", "update", "delete", "truncate"]) expect(r.res[k], k).toBe("ok");
    expect(r.res.reads).toBe("1");
  });
  it("the claim, mark-sent, prune, unread and stale-list functions still work as the service role", () => {
    expect(r.res.claims).toBe("true");
    expect(r.res.marked).toBe("true");
    expect(r.res.unread).toBe("0");
  });
});
