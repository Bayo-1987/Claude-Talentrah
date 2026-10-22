/**
 * Migration 0265, part 1: the seven tables, their columns, constraints, keys and seeds (rows 4 to 7, 10, 13, 15, 16 and 18 of the red-first list).
 *
 * Every test replays the migration file as it is on disk inside a transaction that is rolled back (see migration-0265-support.ts), so a mutant is an edit to the file. Columns are read
 * from information_schema and compared whole; constraints are proved by what they REFUSE (the SQLSTATE), not by their text.
 *
 * Service set of the local stack these ran on: read at run time by migration-0265-local-db.ts (localServiceSet) and printed in the report.
 */
import { describe, expect, it } from "vitest";
import { haveN1Db } from "./migration-0265-local-db";
import { A1, A2, FIXTURES, M1, M2, D1, D2, columnsQuery, deviceSql, draftSql, expectedColumns, normalise, probe, replay0265, rowsOf, scalar, U1, U2 } from "./migration-0265-support";

const KINDS = ["new_applicant", "application_viewed", "match_alert", "admin_message"];
const OUTCOMES = ["sent", "failed", "skipped_opted_out", "skipped_quiet_hours", "skipped_cap", "skipped_deleted", "skipped_inactive"];
const STATUSES = ["draft", "prepared", "submitted", "approved", "sending", "sent", "cancelled", "paused_email_cap", "paused_email_ceiling"];
const long = (n: number) => "x".repeat(n);
/** An endpoint of exactly `n` characters (the prefix is counted, not assumed). */
const endpointOfLength = (n: number) => {
  const prefix = "https://x.invalid/";
  return prefix + long(n - prefix.length);
};

/** An insert built from a base row and overrides (an override replaces the base value of that column, or adds the column). */
const insert = (table: string, base: Record<string, string>, over: Record<string, string> = {}) => {
  const row = { ...base, ...over };
  return `insert into public.${table} (${Object.keys(row).join(", ")}) values (${Object.values(row).join(", ")})`;
};

describe.skipIf(!haveN1Db())("0265 part 1: the tables (replayed in a rolled-back transaction)", () => {
  describe("row 4: notification_deliveries", () => {
    const body = [
      FIXTURES,
      columnsQuery("notification_deliveries"),
      scalar("kind_labels", "select string_agg(distinct m[1], ',' order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m where c.conrelid = 'public.notification_deliveries'::regclass and c.conname = 'notification_deliveries_kind_check'"),
      scalar("channel_labels", "select string_agg(distinct m[1], ',' order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m where c.conrelid = 'public.notification_deliveries'::regclass and c.conname = 'notification_deliveries_channel_check'"),
      ...KINDS.map((k) => rowsOf(`kind_ok_${k}`, `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values ('${U1}', '${k}', gen_random_uuid(), 'inapp')`)),
      probe("kind_bogus", `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values ('${U1}', 'bogus', gen_random_uuid(), 'inapp')`, "23514"),
      probe("channel_bogus", `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values ('${U1}', 'match_alert', gen_random_uuid(), 'sms')`, "23514"),
      probe("user_required", `insert into public.notification_deliveries (kind, subject_id, channel) values ('match_alert', gen_random_uuid(), 'inapp')`, "23502"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => {
      expect(r.ok, r.stderr).toBe(true);
    });
    it("has exactly the nine columns of prompt 01 section 2.1, with their types, nullability and defaults", () => {
      expect(normalise(r.res.cols_notification_deliveries)).toBe(expectedColumns("notification_deliveries"));
    });
    it("the kind CHECK lists exactly the four kinds and accepts each; anything else is refused (23514)", () => {
      expect(r.res.kind_labels).toBe([...KINDS].sort().join(","));
      for (const k of KINDS) expect(r.res[`kind_ok_${k}`], k).toBe("1");
      expect(r.res.kind_bogus).toBe("ok");
    });
    it("the channel CHECK lists exactly inapp, push, email; anything else is refused (23514)", () => {
      expect(r.res.channel_labels).toBe("email,inapp,push");
      expect(r.res.channel_bogus).toBe("ok");
    });
    it("the person is required (23502)", () => {
      expect(r.res.user_required).toBe("ok");
    });
  });

  describe("row 5: the open-claim unique key", () => {
    const row = (k: string, ch: string, dev: string | null, rel = "null") =>
      `insert into public.notification_deliveries (user_id, kind, subject_id, channel, device_id, released_at) values ('${U1}', '${k}', '${S}', '${ch}', ${dev ? `'${dev}'` : "null"}, ${rel})`;
    const S = "00000000-0000-4000-8000-0000000000f1";
    const body = [
      FIXTURES,
      deviceSql(D1),
      deviceSql(D2),
      rowsOf("first", row("match_alert", "inapp", null)),
      probe("same_key_twice", row("match_alert", "inapp", null), "23505"),
      rowsOf("other_channel", row("match_alert", "email", null)),
      rowsOf("other_kind", row("new_applicant", "inapp", null)),
      rowsOf("push_device_1", row("match_alert", "push", D1)),
      rowsOf("push_device_2", row("match_alert", "push", D2)),
      probe("push_device_1_twice", row("match_alert", "push", D1), "23505"),
      probe("null_device_twice", row("match_alert", "push", null) + `; ${row("match_alert", "push", null)}`, "23505"),
      rowsOf("released_row_does_not_block", row("match_alert", "inapp", null, "now()")),
      rowsOf("second_released_row", row("match_alert", "inapp", null, "now()")),
      scalar("index_def", "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'notification_deliveries_open_key'"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("a second open claim with the same key is refused (23505); the same event on another channel, kind or device is not", () => {
      expect(r.res.first).toBe("1");
      expect(r.res.same_key_twice).toBe("ok");
      expect(["other_channel", "other_kind", "push_device_1", "push_device_2"].map((k) => r.res[k])).toEqual(["1", "1", "1", "1"]);
      expect(r.res.push_device_1_twice).toBe("ok");
    });
    it("a missing device counts as one fixed value, so two device-less claims for one event collide (23505)", () => {
      expect(r.res.null_device_twice).toBe("ok");
      expect(r.res.index_def).toMatch(/coalesce\(device_id, '00000000-0000-0000-0000-000000000000'::uuid\)/i);
    });
    it("only OPEN claims count: released rows never block, and many may exist", () => {
      expect(r.res.released_row_does_not_block).toBe("1");
      expect(r.res.second_released_row).toBe("1");
      expect(r.res.index_def).toMatch(/WHERE \(released_at IS NULL\)/);
    });
  });

  describe("row 6: the ledger's foreign keys", () => {
    const S = "00000000-0000-4000-8000-0000000000f2";
    const claim = (dev: string | null) => `insert into public.notification_deliveries (user_id, kind, subject_id, channel, device_id) values ('${U1}', 'match_alert', '${S}', 'push', ${dev ? `'${dev}'` : "null"});`;
    const body = [
      FIXTURES,
      deviceSql(D1),
      claim(D1),
      probe("device_must_exist", `insert into public.notification_deliveries (user_id, kind, subject_id, channel, device_id) values ('${U1}', 'match_alert', gen_random_uuid(), 'push', gen_random_uuid())`, "23503"),
      probe("user_must_exist", `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values (gen_random_uuid(), 'match_alert', gen_random_uuid(), 'inapp')`, "23503"),
      rowsOf("device_deleted", `delete from public.push_subscriptions where id = '${D1}'`),
      scalar("device_id_after", `select coalesce(device_id::text, 'NULL') from public.notification_deliveries where subject_id = '${S}'`),
      scalar("claim_survives", `select count(*) from public.notification_deliveries where subject_id = '${S}'`),
      deviceSql(D2),
      `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values ('${U1}', 'match_alert', gen_random_uuid(), 'inapp');`,
      scalar("rows_before_user_delete", `select count(*) from public.notification_deliveries where user_id = '${U1}'`),
      rowsOf("user_deleted", `delete from auth.users where id = '${U1}'`),
      scalar("rows_after_user_delete", `select count(*) from public.notification_deliveries where user_id = '${U1}'`),
      scalar("devices_after_user_delete", `select count(*) from public.push_subscriptions where user_id = '${U1}'`),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("the device and the person must exist (23503)", () => {
      expect(r.res.device_must_exist).toBe("ok");
      expect(r.res.user_must_exist).toBe("ok");
    });
    it("deleting a device keeps the claim and clears its device_id (ON DELETE SET NULL)", () => {
      expect(r.res.device_deleted).toBe("1");
      expect(r.res.device_id_after).toBe("NULL");
      expect(r.res.claim_survives).toBe("1");
    });
    it("deleting a person removes their claims and their devices (ON DELETE CASCADE through the profile)", () => {
      expect(Number(r.res.rows_before_user_delete)).toBeGreaterThan(0);
      expect(r.res.user_deleted).toBe("1");
      expect(r.res.rows_after_user_delete).toBe("0");
      expect(r.res.devices_after_user_delete).toBe("0");
    });
  });

  describe("row 6b: KNOWN DEFECT, reported for a ruling (N1-R14 device_id SET NULL x the open-claim unique key)", () => {
    // Two devices of one person each hold an OPEN push claim for the same event. Deleting a device sets its claim's device_id to null, and a null device counts as one fixed value in the
    // unique key, so the second claim then collides with the first. This test pins what the database does TODAY so that the report's finding is reproducible and so that a ruling
    // that changes the design has to change this test on purpose. It does not say the behaviour is right.
    const S = "00000000-0000-4000-8000-0000000000f3";
    const claim = (dev: string) => `insert into public.notification_deliveries (user_id, kind, subject_id, channel, device_id, sent_at) values ('${U1}', 'match_alert', '${S}', 'push', '${dev}', now());`;
    const body = [
      FIXTURES,
      deviceSql(D1),
      deviceSql(D2),
      claim(D1),
      claim(D2),
      rowsOf("first_device_deleted", `delete from public.push_subscriptions where id = '${D1}'`),
      probe("second_device_delete_collides", `delete from public.push_subscriptions where id = '${D2}'`, "23505"),
      scalar("devices_left", `select count(*) from public.push_subscriptions where user_id = '${U1}'`),
      rowsOf("person_delete_still_works", `delete from auth.users where id = '${U1}'`),
      scalar("claims_left_after_person_delete", `select count(*) from public.notification_deliveries where subject_id = '${S}'`),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("TODAY: deleting the second device is refused with 23505 and the device stays (the defect)", () => {
      expect(r.res.first_device_deleted).toBe("1");
      expect(r.res.second_device_delete_collides).toBe("ok");
      expect(r.res.devices_left).toBe("1");
    });
    it("deleting the whole person is NOT affected: the claims and devices go with them", () => {
      expect(r.res.person_delete_still_works).toBe("1");
      expect(r.res.claims_left_after_person_delete).toBe("0");
    });
  });

  describe("row 7: push_subscriptions", () => {
    let n = 0;
    const ins = (over: Record<string, string> = {}) =>
      insert("push_subscriptions", { user_id: `'${U1}'`, endpoint: `'https://push.example.invalid/${(n += 1)}'`, p256dh: "'k'", auth: "'a'", ua_short: "'Chrome'" }, over);
    const body = [
      FIXTURES,
      columnsQuery("push_subscriptions"),
      rowsOf("plain", ins()),
      scalar("default_zone", "select timezone from public.push_subscriptions limit 1"),
      scalar("last_seen_set", "select (last_seen_at is not null)::text from public.push_subscriptions limit 1"),
      probe("endpoint_unique", `${deviceSql(D1, U1, "https://push.example.invalid/dup")} ${deviceSql(D2, U1, "https://push.example.invalid/dup")}`, "23505"),
      rowsOf("endpoint_2048", ins({ endpoint: `'${endpointOfLength(2048)}'` })),
      probe("endpoint_2049", ins({ endpoint: `'${endpointOfLength(2049)}'` }), "23514"),
      rowsOf("p256dh_256", ins({ p256dh: `'${long(256)}'` })),
      probe("p256dh_257", ins({ p256dh: `'${long(257)}'` }), "23514"),
      rowsOf("auth_256", ins({ auth: `'${long(256)}'` })),
      probe("auth_257", ins({ auth: `'${long(257)}'` }), "23514"),
      rowsOf("ua_40", ins({ ua_short: `'${long(40)}'` })),
      probe("ua_41", ins({ ua_short: `'${long(41)}'` }), "23514"),
      rowsOf("tz_64", ins({ timezone: `'${long(64)}'` })),
      probe("tz_65", ins({ timezone: `'${long(65)}'` }), "23514"),
      ...["gone", "user", "kill", "deleted", "bad_key"].map((x) => rowsOf(`reason_${x}`, ins({ revoke_reason: `'${x}'` }))),
      probe("reason_bogus", ins({ revoke_reason: "'rebound'" }), "23514"),
      probe("user_required", `insert into public.push_subscriptions (endpoint, p256dh, auth, ua_short) values ('https://x.invalid/u', 'k', 'a', 'c')`, "23502"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("has the eleven columns of prompt 01 section 2.4, last_seen_at NOT NULL default now() (decision 8)", () => {
      expect(normalise(r.res.cols_push_subscriptions)).toBe(expectedColumns("push_subscriptions"));
      expect(r.res.last_seen_set).toBe("true");
    });
    it("the time zone defaults to Africa/Lagos", () => expect(r.res.default_zone).toBe("Africa/Lagos"));
    it("the endpoint is unique (23505)", () => expect(r.res.endpoint_unique).toBe("ok"));
    it("the caps are CHECK constraints: endpoint 2048, p256dh and auth 256, ua_short 40, time zone 64 (the limit is accepted, one more is refused with 23514)", () => {
      for (const k of ["endpoint_2048", "p256dh_256", "auth_256", "ua_40", "tz_64"]) expect(r.res[k], k).toBe("1");
      for (const k of ["endpoint_2049", "p256dh_257", "auth_257", "ua_41", "tz_65"]) expect(r.res[k], k).toBe("ok");
    });
    it("revoke_reason is the closed list gone, user, kill, deleted, bad_key (no 'rebound')", () => {
      for (const x of ["gone", "user", "kill", "deleted", "bad_key"]) expect(r.res[`reason_${x}`], x).toBe("1");
      expect(r.res.reason_bogus).toBe("ok");
    });
    it("the person is required (23502)", () => expect(r.res.user_required).toBe("ok"));
  });

  describe("row 10: admin_messages", () => {
    const msg = (over: Record<string, string> = {}) =>
      insert("admin_messages", { created_by: `'${A1}'`, created_by_email: "'a1@example.test'", kind: "'service_announcement'", title: "'T'", body: "'B'", channels: "array['inapp']", segment_key: "'everyone'" }, over);
    const body = [
      FIXTURES,
      columnsQuery("admin_messages"),
      scalar("status_labels", "select string_agg(distinct m[1], ',' order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m where c.conrelid = 'public.admin_messages'::regclass and c.conname = 'admin_messages_status_check'"),
      scalar("recipient_count_column", "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'admin_messages' and column_name = 'recipient_count'"),
      rowsOf("plain_draft", msg()),
      scalar("defaults", "select status || '/' || requires_approval || '/' || audience_count || '/' || sent_count || '/' || failed_count || '/' || skipped_count from public.admin_messages limit 1"),
      ...STATUSES.map((st) => rowsOf(`status_${st}`, msg({ status: `'${st}'`, approved_by_email: "'ap@example.test'" }))),
      probe("status_rejected", msg({ status: "'rejected'" }), "23514"),
      probe("status_pending", msg({ status: "'pending_approval'" }), "23514"),
      probe("kind_bogus", msg({ kind: "'newsletter'" }), "23514"),
      probe("channels_empty", msg({ channels: "array[]::text[]" }), "23514"),
      probe("channels_unknown", msg({ channels: "array['inapp','sms']" }), "23514"),
      rowsOf("channels_all", msg({ channels: "array['inapp','push','email']" })),
      rowsOf("title_80", msg({ title: `'${long(80)}'` })),
      probe("title_81", msg({ title: `'${long(81)}'` }), "23514"),
      rowsOf("body_500", msg({ body: `'${long(500)}'` })),
      probe("body_501", msg({ body: `'${long(501)}'` }), "23514"),
      probe("segment_bogus", msg({ segment_key: "'nobody'" }), "23514"),
      rowsOf("segment_params_ok", msg({ segment_params: `'{"days":30,"since":"2026-01-01","country":"Nigeria"}'` })),
      probe("segment_params_unknown_key", msg({ segment_params: `'{"limit":5}'` }), "23514"),
      probe("segment_params_not_object", msg({ segment_params: `'[1]'` }), "23514"),
      probe("approver_is_creator", msg({ approved_by: `'${A1}'` }), "23514"),
      rowsOf("approver_differs", msg({ approved_by: `'${A2}'` })),
      probe("approved_without_approver", msg({ status: "'approved'" }), "23514"),
      rowsOf("approved_when_not_required", msg({ status: "'approved'", requires_approval: "false" })),
      probe("sent_without_approver", msg({ status: "'sent'" }), "23514"),
      probe("promotion_prepared_without_consent", msg({ kind: "'promotion'", status: "'prepared'" }), "23514"),
      rowsOf("promotion_prepared_with_consent", msg({ kind: "'promotion'", status: "'prepared'", consent_line: "'You asked for offers'" })),
      rowsOf("kind_confirmed_equal", msg({ kind_confirmed_by_approver: "'service_announcement'" })),
      probe("kind_confirmed_other", msg({ kind_confirmed_by_approver: "'promotion'" }), "23514"),
      probe("count_negative", msg({ sent_count: "-1" }), "23514"),
      probe("created_by_email_required", insert("admin_messages", { kind: "'service_announcement'", title: "'T'", body: "'B'", channels: "array['inapp']", segment_key: "'everyone'" }), "23502"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("has the 22 columns of the contract's message row; the three integer counts are NOT NULL default 0 and there is no recipient_count (decision 13)", () => {
      expect(normalise(r.res.cols_admin_messages)).toBe(expectedColumns("admin_messages"));
      expect(r.res.recipient_count_column).toBe("0");
      expect(r.res.defaults).toBe("draft/true/0/0/0/0");
    });
    it("the status CHECK is exactly the nine statuses (N1-R20) and 'rejected' is not one of them", () => {
      expect(r.res.status_labels).toBe([...STATUSES].sort().join(","));
      for (const s of STATUSES) expect(r.res[`status_${s}`], s).toBe("1");
      expect(r.res.status_rejected).toBe("ok");
      expect(r.res.status_pending).toBe("ok");
    });
    it("kind, channels (non-empty, subset), title <= 80, body <= 500 and the closed segment list are enforced (23514)", () => {
      expect(["kind_bogus", "channels_empty", "channels_unknown", "title_81", "body_501", "segment_bogus"].map((k) => r.res[k])).toEqual(Array(6).fill("ok"));
      expect(["channels_all", "title_80", "body_500"].map((k) => r.res[k])).toEqual(["1", "1", "1"]);
    });
    it("segment_params is an object whose keys are only days, since, country", () => {
      expect(r.res.segment_params_ok).toBe("1");
      expect(r.res.segment_params_unknown_key).toBe("ok");
      expect(r.res.segment_params_not_object).toBe("ok");
    });
    it("the approver cannot be the creator (23514), and an approved message needs an approver or the approver's email snapshot", () => {
      expect(r.res.approver_is_creator).toBe("ok");
      expect(r.res.approver_differs).toBe("1");
      expect(r.res.approved_without_approver).toBe("ok");
      expect(r.res.sent_without_approver).toBe("ok");
      expect(r.res.approved_when_not_required).toBe("1");
    });
    it("a promotion past draft needs a consent line; the approver's kind confirmation equals the stored kind; counts are not negative", () => {
      expect(r.res.promotion_prepared_without_consent).toBe("ok");
      expect(r.res.promotion_prepared_with_consent).toBe("1");
      expect(r.res.kind_confirmed_equal).toBe("1");
      expect(r.res.kind_confirmed_other).toBe("ok");
      expect(r.res.count_negative).toBe("ok");
      expect(r.res.created_by_email_required).toBe("ok");
    });
  });

  describe("row 13: admin_message_recipients", () => {
    const rec = (m: string, u: string, over: Record<string, string> = {}) => insert("admin_message_recipients", { message_id: `'${m}'`, user_id: `'${u}'` }, over);
    const body = [
      FIXTURES,
      draftSql(M1),
      draftSql(M2),
      columnsQuery("admin_message_recipients"),
      scalar("outcome_labels", "select string_agg(distinct m[1], ',' order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m where c.conrelid = 'public.admin_message_recipients'::regclass and c.contype = 'c'"),
      rowsOf("first", rec(M1, U1)),
      probe("pair_unique", rec(M1, U1), "23505"),
      rowsOf("same_user_other_message", rec(M2, U1)),
      ...OUTCOMES.map((o) => rowsOf(`outcome_${o}`, `update public.admin_message_recipients set push_outcome = '${o}', email_outcome = '${o}' where message_id = '${M1}' and user_id = '${U1}'`)),
      probe("push_outcome_bogus", rec(M2, U2, { push_outcome: "'delivered'" }), "23514"),
      probe("email_outcome_bogus", rec(M2, U2, { email_outcome: "'bounced'" }), "23514"),
      probe("message_must_exist", rec("00000000-0000-4000-8000-0000000000ff", U1), "23503"),
      probe("message_delete_restricted", `delete from public.admin_messages where id = '${M1}'`, "23503"),
      scalar("recipients_before", `select count(*) from public.admin_message_recipients where user_id = '${U1}'`),
      rowsOf("user_deleted", `delete from auth.users where id = '${U1}'`),
      scalar("recipients_after", `select count(*) from public.admin_message_recipients where user_id = '${U1}'`),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("has the eight columns of the contract's recipient row; the flags default false", () => {
      expect(normalise(r.res.cols_admin_message_recipients)).toBe(expectedColumns("admin_message_recipients"));
    });
    it("the outcome CHECKs list exactly the seven outcomes of prompt 01 section 2.7, and anything else is refused (23514)", () => {
      expect(r.res.outcome_labels).toBe([...OUTCOMES].sort().join(","));
      expect(r.res.push_outcome_bogus).toBe("ok");
      expect(r.res.email_outcome_bogus).toBe("ok");
    });
    it("every one of the seven outcomes is accepted for both channels", () => {
      for (const o of OUTCOMES) expect(r.res[`outcome_${o}`], o).toBe("1");
    });
    it("one row per message and person (23505); the message must exist (23503)", () => {
      expect(r.res.first).toBe("1");
      expect(r.res.pair_unique).toBe("ok");
      expect(r.res.same_user_other_message).toBe("1");
      expect(r.res.message_must_exist).toBe("ok");
    });
    it("a message with recipients cannot be deleted (ON DELETE RESTRICT, 23503)", () => expect(r.res.message_delete_restricted).toBe("ok"));
    it("deleting a person removes their recipient rows (ON DELETE CASCADE through the profile)", () => {
      expect(Number(r.res.recipients_before)).toBeGreaterThan(0);
      expect(r.res.recipients_after).toBe("0");
    });
  });

  describe("rows 15 and 16: the settings and their change log", () => {
    const body = [
      FIXTURES,
      columnsQuery("notification_settings"),
      columnsQuery("notification_setting_changes"),
      scalar("seeds", "select string_agg(key || '=' || int_value || '/' || coalesce(updated_by_email, 'NULL'), ',' order by key) from public.notification_settings"),
      probe("setting_key_bogus", "insert into public.notification_settings (key, int_value) values ('other_limit', 5)", "23514"),
      probe("setting_key_duplicate", "insert into public.notification_settings (key, int_value) values ('mass_email_cap_24h', 5)", "23505"),
      probe("setting_negative", "update public.notification_settings set int_value = -1 where key = 'mass_email_cap_24h'", "23514"),
      probe("setting_null", "update public.notification_settings set int_value = null where key = 'mass_email_cap_24h'", "23502"),
      scalar("change_types", "select string_agg(column_name || '=' || data_type, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'notification_setting_changes' and column_name in ('old_value', 'new_value')"),
      rowsOf("change_ok", "insert into public.notification_setting_changes (key, old_value, new_value) values ('mass_email_cap_24h', 50, 60)"),
      rowsOf("change_first_has_no_old", "insert into public.notification_setting_changes (key, new_value) values ('mass_email_ceiling_month', 10)"),
      probe("change_unknown_key", "insert into public.notification_setting_changes (key, new_value) values ('other_limit', 1)", "23503"),
      probe("change_text_value", "insert into public.notification_setting_changes (key, new_value) values ('mass_email_cap_24h', 'many')", "22P02"),
      scalar("change_fk_target", "select confrelid::regclass::text from pg_constraint where conrelid = 'public.notification_setting_changes'::regclass and contype = 'f'"),
      scalar("actor_fk_count", "select count(*) from pg_constraint where contype = 'f' and conrelid in ('public.notification_setting_changes'::regclass, 'public.admin_message_events'::regclass) and pg_get_constraintdef(oid) like '%actor_admin_id%'"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("notification_settings: key, int_value NOT NULL, updated_by_email, updated_at; the migration seeds exactly the two limits, 50 and 2000", () => {
      expect(normalise(r.res.cols_notification_settings)).toBe(expectedColumns("notification_settings"));
      expect(r.res.seeds).toBe("mass_email_cap_24h=50/NULL,mass_email_ceiling_month=2000/NULL");
    });
    it("the key is a closed pair (23514) and unique (23505); the value is a non-negative integer (23514, 23502)", () => {
      expect(["setting_key_bogus", "setting_key_duplicate", "setting_negative", "setting_null"].map((k) => r.res[k])).toEqual(Array(4).fill("ok"));
    });
    it("notification_setting_changes has the seven columns of prompt 01 section 2.8; old_value and new_value are INTEGER (list D entries 26 and 27), old_value nullable (N1-R15)", () => {
      expect(normalise(r.res.cols_notification_setting_changes)).toBe(expectedColumns("notification_setting_changes"));
      expect(r.res.change_types).toBe("new_value=integer,old_value=integer");
      expect(r.res.change_ok).toBe("1");
      expect(r.res.change_first_has_no_old).toBe("1");
      expect(r.res.change_text_value).toBe("ok");
    });
    it("the change key is a foreign key to the settings table (list D entry 25); an unknown key is refused (23503)", () => {
      expect(r.res.change_fk_target).toBe("notification_settings");
      expect(r.res.change_unknown_key).toBe("ok");
    });
    it("actor_admin_id has NO foreign key on the two append-only tables (N1-R14)", () => {
      expect(r.res.actor_fk_count).toBe("0");
    });
  });

  describe("row 14b: admin_message_events keeps a closed event list and a closed, address-free detail", () => {
    const EVENTS = ["created", "prepared", "test_sent", "submitted", "approved", "rejected", "send_started", "send_finished", "cancelled", "flag_stopped", "claim_resolved", "resumed"];
    const ev = (over: Record<string, string> = {}) => insert("admin_message_events", { message_id: `'${M1}'`, event: "'created'" }, over);
    const body = [
      FIXTURES,
      draftSql(M1),
      scalar("event_labels", "select string_agg(distinct m[1], ',' order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m where c.conrelid = 'public.admin_message_events'::regclass and c.conname = 'admin_message_events_event_check'"),
      columnsQuery("admin_message_events"),
      ...EVENTS.map((e) => rowsOf(`event_${e}`, ev({ event: `'${e}'` }))),
      probe("event_bogus", ev({ event: "'deleted'" }), "23514"),
      rowsOf("detail_kind_confirmed", ev({ detail: `'{"kind_confirmed":"promotion"}'` })),
      rowsOf("detail_resolution", ev({ detail: `'{"resolution":"mark_sent"}'` })),
      probe("detail_unknown_key", ev({ detail: `'{"audience":5}'` }), "23514"),
      probe("detail_email_inside", ev({ detail: `'{"resolution":"a@b.test"}'` }), "23514"),
      probe("detail_not_object", ev({ detail: `'[]'` }), "23514"),
      rowsOf("no_message_allowed", insert("admin_message_events", { event: "'created'" })),
      probe("message_must_exist", ev({ message_id: "'00000000-0000-4000-8000-0000000000fe'" }), "23503"),
      probe("message_delete_restricted", `delete from public.admin_messages where id = '${M1}'`, "23503"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("has the seven columns of the contract's event row", () => {
      expect(normalise(r.res.cols_admin_message_events)).toBe(expectedColumns("admin_message_events"));
    });
    it("the event CHECK lists exactly the twelve events of the email-pins addendum, and each is accepted", () => {
      expect(r.res.event_labels).toBe([...EVENTS].sort().join(","));
      for (const e of EVENTS) expect(r.res[`event_${e}`], e).toBe("1");
      expect(r.res.event_bogus).toBe("ok");
    });
    it("the detail holds only kind_confirmed or resolution, is an object, and never holds an address (23514)", () => {
      expect(r.res.detail_kind_confirmed).toBe("1");
      expect(r.res.detail_resolution).toBe("1");
      for (const k of ["detail_unknown_key", "detail_email_inside", "detail_not_object"]) expect(r.res[k], k).toBe("ok");
    });
    it("the message is optional, must exist when given (23503), and cannot be deleted while events refer to it (ON DELETE RESTRICT)", () => {
      expect(r.res.no_message_allowed).toBe("1");
      expect(r.res.message_must_exist).toBe("ok");
      expect(r.res.message_delete_restricted).toBe("ok");
    });
  });

  describe("row 20: a replay runs in a private scratch database, never in the shared one", () => {
    const r = replay0265([scalar("db", "select current_database()"), scalar("is_scratch_profiles", "select (to_regclass('public.profiles') is not null)::text")].join("\n"));
    it("the replay applies and runs in a database named n1_replay_*, not in postgres", () => {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.res.db).toMatch(/^n1_replay_\d+_[a-z0-9]+$/);
      expect(r.res.db).not.toBe("postgres");
    });
    it("the stand-in parents exist there (the migration's foreign keys need them)", () => {
      expect(r.res.is_scratch_profiles).toBe("true");
    });
  });

  describe("row 18: nothing needs a sequence", () => {
    const body = [
      scalar("sequences_owned", `select count(*) from pg_class s join pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i') join pg_class t on t.oid = d.refobjid where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace and t.relname in ('notification_deliveries','push_subscriptions','admin_messages','admin_message_recipients','admin_message_events','notification_settings','notification_setting_changes')`),
      scalar("identity_or_nextval", `select count(*) from pg_attribute a join pg_class t on t.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where t.relnamespace = 'public'::regnamespace and t.relname in ('notification_deliveries','push_subscriptions','admin_messages','admin_message_recipients','admin_message_events','notification_settings','notification_setting_changes') and a.attnum > 0 and not a.attisdropped and (a.attidentity <> '' or pg_get_expr(d.adbin, d.adrelid) like 'nextval%')`),
      scalar("tables_present", `select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('notification_deliveries','push_subscriptions','admin_messages','admin_message_recipients','admin_message_events','notification_settings','notification_setting_changes')`),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies and creates all seven tables", () => {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.res.tables_present).toBe("7");
    });
    it("no sequence, identity column or serial default belongs to them (so there is nothing to grant usage on)", () => {
      expect(r.res.sequences_owned).toBe("0");
      expect(r.res.identity_or_nextval).toBe("0");
    });
  });
});
