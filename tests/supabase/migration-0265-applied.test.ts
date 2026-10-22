/**
 * Migration 0265 part 1 AS APPLIED to the database under test: the real schema, with the migration runner's own application of the file. Everything here is a read of the catalog or
 * a rolled-back transaction with NO DDL in it, so it takes only row locks and never waits for, or blocks, another suite (the replay tests, which do run DDL, use a private scratch
 * database for that reason; see migration-0265-support.ts).
 *
 * What this adds to the replay tests: the replays prove the file's text does what it says against stand-ins for profiles, admin_users and auth.users. This file proves the same result
 * on the real tables, which matters where the real table has more than the stand-in (an admin_users row that other tables refer to, the real sign-up trigger, the real auth.uid()).
 *
 * It FAILS, and does not skip, when 0265 has not been applied to the database under test: a skipped check would look like a passing one.
 */
import { describe, expect, it } from "vitest";
import {
  A1, A2, COLUMNS, D1, D2, EXPECTED_GRANTS, FIXTURES, IN_LIST, M1, OTHER_TABLES, SAFE_COLUMNS, TABLES, U1, U2, applied0265, asRole, columnGrants, columnsQuery, deviceSql, draftSql, expectedColumns,
  functionAcl, grantMatrix, normalise, probe, rowsOf, scalar,
} from "./migration-0265-support";

const eventRow = `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values ('${M1}', 'created', '${A1}', 'operator@example.test');`;
const changeRow = `insert into public.notification_setting_changes (key, old_value, new_value, actor_admin_id, actor_email) values ('mass_email_cap_24h', 50, 60, '${A1}', 'operator@example.test');`;

describe("0265 part 1 as applied to the database under test (no DDL)", () => {
  describe("the catalog", () => {
    const body = [
      scalar("tables_present", `select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ${IN_LIST}`),
      grantMatrix(),
      columnGrants,
      functionAcl,
      ...TABLES.map((t) => columnsQuery(t)),
      scalar("rls_on", `select string_agg(relname || '=' || relrowsecurity, ',' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relname in ${IN_LIST}`),
      scalar("policies", `select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || roles::text, ' ' order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename in ${IN_LIST}`),
      scalar("triggers", `select string_agg(c.relname || ':' || t.tgname, ',' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ${IN_LIST}`),
      scalar("open_key_def", "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'notification_deliveries_open_key'"),
      scalar("fk_indexes", `select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and indexname in ('notification_deliveries_device_id_idx', 'push_subscriptions_user_id_idx', 'admin_message_recipients_user_id_idx', 'admin_message_events_message_id_idx')`),
      scalar("link_check", "select count(*) from pg_constraint where conrelid = 'public.admin_messages'::regclass and conname = 'admin_messages_link_path_check'"),
      scalar("setting_keys", "select string_agg(key, ',' order by key) from public.notification_settings"),
      scalar("functions", "select string_agg(proname || ':' || prosecdef || ':' || coalesce(proconfig::text, ''), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('notification_guard_append_only', 'notification_guard_message_edit')"),
    ].join("\n");
    const r = applied0265(body);

    it("0265 is applied: all seven tables exist (if this fails, apply the migrations to the database under test)", () => {
      expect(r.ok, r.stderr).toBe(true);
      expect(r.res.tables_present, "0265 has not been applied to this database").toBe("7");
    });
    it("every table has exactly the expected grants per role, and the person's only column privilege is SELECT on the five safe columns", () => {
      for (const t of TABLES) expect(r.res[`grants_${t}`], t).toBe(EXPECTED_GRANTS[t]);
      expect(r.res.safe_columns).toBe(SAFE_COLUMNS);
      expect(r.res.column_grants_elsewhere).toBe("0");
    });
    it("the two trigger functions are internal: executable by nobody but their owner, SECURITY INVOKER, with an empty search_path", () => {
      expect(r.res.function_execute).toBe("none");
      expect(r.res.functions).toBe('notification_guard_append_only:false:{"search_path=\\"\\""},notification_guard_message_edit:false:{"search_path=\\"\\""}');
    });
    it("the columns of every table are the contract's, with their types, nullability and defaults", () => {
      for (const t of TABLES) expect(normalise(r.res[`cols_${t}`]), t).toBe(expectedColumns(t));
      expect(Object.keys(COLUMNS).sort()).toEqual([...TABLES].sort());
    });
    it("row security is on for all seven, and push_subscriptions has exactly the two own-row policies for authenticated", () => {
      expect(r.res.rls_on).toBe([...TABLES].sort().map((t) => `${t}=true`).join(","));
      expect(r.res.policies).toBe("push_subscriptions.push_subscriptions_delete_own:DELETE:{authenticated} push_subscriptions.push_subscriptions_select_own:SELECT:{authenticated}");
    });
    it("the triggers are the three guards on the append-only tables (row and truncate) and the freeze on admin_messages", () => {
      expect(r.res.triggers).toBe(
        [
          "admin_message_events:admin_message_events_append_only_row",
          "admin_message_events:admin_message_events_append_only_truncate",
          "admin_messages:admin_messages_guard_edit",
          "notification_setting_changes:notification_setting_changes_append_only_row",
          "notification_setting_changes:notification_setting_changes_append_only_truncate",
        ].join(","),
      );
    });
    it("the open-claim key leaves a push claim without a device out, and the four foreign-key indexes and the link check exist (N1-R27)", () => {
      expect(r.res.open_key_def).toMatch(/WHERE \(\(released_at IS NULL\) AND \(\(channel <> 'push'::text\) OR \(device_id IS NOT NULL\)\)\)/);
      expect(r.res.fk_indexes).toBe("admin_message_events_message_id_idx,admin_message_recipients_user_id_idx,notification_deliveries_device_id_idx,push_subscriptions_user_id_idx");
      expect(r.res.link_check).toBe("1");
    });
    it("the settings table holds exactly the two limits (their values are not asserted: an operator may have changed them)", () => {
      expect(r.res.setting_keys).toBe("mass_email_cap_24h,mass_email_ceiling_month");
    });
  });

  describe("behaviour on the real tables (rolled back, no DDL)", () => {
    const body = [
      FIXTURES,
      draftSql(M1),
      `update public.admin_messages set status = 'prepared' where id = '${M1}';`,
      `update public.admin_messages set status = 'submitted' where id = '${M1}';`,
      `update public.admin_messages set approved_by = '${A2}', approved_by_email = 'a2@example.test', status = 'approved' where id = '${M1}';`,
      eventRow,
      changeRow,
      deviceSql(D1, U1),
      deviceSql(D2, U2),
      // two devices of one person, an open push claim each for ONE event, both deleted: neither delete collides (N1-R27 Q1), on the real tables
      deviceSql("00000000-0000-4000-8000-0000000000d6", U1),
      deviceSql("00000000-0000-4000-8000-0000000000d7", U1),
      `insert into public.notification_deliveries (user_id, kind, subject_id, channel, device_id, sent_at) values ('${U1}', 'match_alert', '00000000-0000-4000-8000-0000000000f5', 'push', '00000000-0000-4000-8000-0000000000d6', now()), ('${U1}', 'match_alert', '00000000-0000-4000-8000-0000000000f5', 'push', '00000000-0000-4000-8000-0000000000d7', now());`,
      rowsOf("two_devices_deleted", `delete from public.push_subscriptions where id in ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000d7')`),
      // an admin can be deleted while events and an APPROVED message exist (N1-R14, R22), on the real admin_users
      rowsOf("delete_creator", `delete from public.admin_users where id = '${A1}'`),
      scalar("creator_after", `select coalesce(created_by::text, 'NULL') from public.admin_messages where id = '${M1}'`),
      rowsOf("delete_approver", `delete from public.admin_users where id = '${A2}'`),
      scalar("approver_after", `select coalesce(approved_by::text, 'NULL') || '/' || approved_by_email || '/' || status from public.admin_messages where id = '${M1}'`),
      scalar("events_kept", `select count(*) from public.admin_message_events where message_id = '${M1}'`),
      scalar("event_actor_kept", `select actor_admin_id from public.admin_message_events where message_id = '${M1}' limit 1`),
      // the append-only tables refuse the owner too
      probe("events_update", "update public.admin_message_events set actor_email = 'x'", "42501"),
      probe("events_delete", `delete from public.admin_message_events where message_id = '${M1}'`, "42501"),
      probe("changes_update", "update public.notification_setting_changes set actor_email = 'x'", "42501"),
      probe("changes_delete", "delete from public.notification_setting_changes", "42501"),
      // a signed-in person and the real auth.uid()
      asRole(
        "authenticated",
        [
          rowsOf("own_devices_visible", "select id, ua_short, created_at, last_seen_at, revoked_at from public.push_subscriptions"),
          probe("endpoint_refused", "select endpoint from public.push_subscriptions", "42501"),
          rowsOf("delete_other_users_device", `delete from public.push_subscriptions where id = '${D2}'`),
          rowsOf("delete_own_device", `delete from public.push_subscriptions where id = '${D1}'`),
        ],
        U1,
      ),
      ...["authenticated", "anon"].flatMap((role) =>
        OTHER_TABLES.map((t) => asRole(role as "anon" | "authenticated", [probe(`${role}_${t}`, `select * from public.${t}`, "42501")], role === "authenticated" ? U1 : undefined)),
      ),
      // a person's deletion removes their devices, claims and recipient rows (cascade through the real profiles table)
      deviceSql("00000000-0000-4000-8000-0000000000d3", U2),
      `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values ('${U2}', 'match_alert', gen_random_uuid(), 'inapp');`,
      `insert into public.admin_message_recipients (message_id, user_id) values ('${M1}', '${U2}');`,
      scalar("rows_before_person_delete", `select (select count(*) from public.push_subscriptions where user_id = '${U2}') + (select count(*) from public.notification_deliveries where user_id = '${U2}') + (select count(*) from public.admin_message_recipients where user_id = '${U2}')`),
      rowsOf("person_deleted", `delete from auth.users where id = '${U2}'`),
      scalar("rows_after_person_delete", `select (select count(*) from public.push_subscriptions where user_id = '${U2}') + (select count(*) from public.notification_deliveries where user_id = '${U2}') + (select count(*) from public.admin_message_recipients where user_id = '${U2}')`),
    ].join("\n");
    const r = applied0265(body);

    it("the transaction ran", () => expect(r.ok, r.stderr).toBe(true));
    it("deleting the creator, then the approver of an APPROVED message, succeeds on the real admin_users; the audit rows and the email snapshots stay", () => {
      expect(r.res.delete_creator).toBe("1");
      expect(r.res.creator_after).toBe("NULL");
      expect(r.res.delete_approver).toBe("1");
      expect(r.res.approver_after).toBe("NULL/a2@example.test/approved");
      expect(r.res.events_kept).toBe("1");
      expect(r.res.event_actor_kept).toBe(A1);
    });
    it("deleting both devices that hold an open push claim for one event succeeds on the real tables", () => {
      expect(r.res.two_devices_deleted).toBe("2");
    });
    it("the append-only tables refuse update and delete with 42501, even for the table's owner", () => {
      for (const k of ["events_update", "events_delete", "changes_update", "changes_delete"]) expect(r.res[k], k).toBe("ok");
    });
    it("a signed-in person sees only their own device through five columns and deletes only their own by id; other people and anon see nothing of the other six tables", () => {
      expect(r.res.own_devices_visible).toBe("1");
      expect(r.res.endpoint_refused).toBe("ok");
      expect(r.res.delete_other_users_device).toBe("0");
      expect(r.res.delete_own_device).toBe("1");
      for (const role of ["authenticated", "anon"]) for (const t of OTHER_TABLES) expect(r.res[`${role}_${t}`], `${role} ${t}`).toBe("ok");
    });
    it("deleting a person removes their devices, claims and recipient rows", () => {
      // two devices (D2 survived the other person's delete attempt above, D3 was added), one claim and one recipient row
      expect(Number(r.res.rows_before_person_delete)).toBe(4);
      expect(r.res.person_deleted).toBe("1");
      expect(r.res.rows_after_person_delete).toBe("0");
    });
  });
});
