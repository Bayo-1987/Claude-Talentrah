/**
 * Migration 0265, part 1: who can do what (rows 8, 9, 11, 12, 14, 17 and 19 of the red-first list, and the part-1 rollback).
 *
 * Every test replays the migration as it is on disk in a transaction that is rolled back, then acts AS a database role with `set local role` (and, for a signed-in person, the JWT claims
 * that `auth.uid()` reads), so a refusal is the database's own refusal. Where the SQLSTATE cannot tell two causes apart (a missing grant and a trigger both answer 42501) the test
 * also reads the privilege itself.
 *
 *   row 8   push_subscriptions: a person reads five columns of their own rows and may delete them by id; nothing else
 *   row 9   push_subscriptions: row security limits that to the person's own rows
 *   row 11  a message cannot be edited after it leaves draft
 *   row 12  deleting an admin (with events and an approved message present) succeeds
 *   row 14  the two append-only tables
 *   row 17  the exact grant list per table and role, and the self-check that guards it
 *   row 19  the same result with the platform's automatic grants switched off
 */
import { describe, expect, it } from "vitest";
import {
  A1, A2, D1, D2, EXPECTED_GRANTS, F0265, FIXTURES, IN_LIST, M1, NO_DEFAULT_GRANTS, OTHER_TABLES, R0265, SAFE_COLUMNS, TABLES, U1, U2, asRole, columnGrants, deviceSql, draftSql, functionAcl, grantMatrix, probe,
  readMigration, readRollback, replay0265, rowsOf, scalar, usesNewValueAsEnum,
} from "./migration-0265-support";

const eventRow = `insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values ('${M1}', 'created', '${A1}', 'secret-operator@example.test');`;
const changeRow = `insert into public.notification_setting_changes (key, old_value, new_value, actor_admin_id, actor_email) values ('mass_email_cap_24h', 50, 60, '${A1}', 'secret-operator@example.test');`;

describe("0265 part 1: privileges, row security and triggers (replayed in a rolled-back transaction)", () => {
  describe("row 8: push_subscriptions, what a signed-in person can do (N1-R9, grants addendum G4)", () => {
    const body = [
      FIXTURES,
      deviceSql(D1, U1),
      deviceSql(D2, U2),
      asRole(
        "authenticated",
        [
          rowsOf("safe_select", "select id, ua_short, created_at, last_seen_at, revoked_at from public.push_subscriptions"),
          probe("select_endpoint", "select endpoint from public.push_subscriptions", "42501"),
          probe("select_user_id", "select user_id from public.push_subscriptions", "42501"),
          probe("select_p256dh", "select p256dh from public.push_subscriptions", "42501"),
          probe("select_auth", "select auth from public.push_subscriptions", "42501"),
          probe("select_timezone", "select timezone from public.push_subscriptions", "42501"),
          probe("select_star", "select * from public.push_subscriptions", "42501"),
          probe("insert_refused", `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua_short) values ('${U1}', 'https://x.invalid/new', 'k', 'a', 'c')`, "42501"),
          probe("update_refused", "update public.push_subscriptions set ua_short = 'x'", "42501"),
          probe("update_by_id_refused", `update public.push_subscriptions set revoked_at = now() where id = '${D1}'`, "42501"),
          probe("delete_filtered_by_user_id", `delete from public.push_subscriptions where user_id = '${U1}'`, "42501"),
          rowsOf("delete_other_users_row", `delete from public.push_subscriptions where id = '${D2}'`),
          rowsOf("delete_own_row_by_id", `delete from public.push_subscriptions where id = '${D1}'`),
          rowsOf("safe_select_after", "select id from public.push_subscriptions"),
        ],
        U1,
      ),
      scalar("other_row_untouched", `select count(*) from public.push_subscriptions where id = '${D2}'`),
      scalar("own_row_gone", `select count(*) from public.push_subscriptions where id = '${D1}'`),
      asRole("anon", [probe("anon_select", "select id from public.push_subscriptions", "42501"), probe("anon_delete", "delete from public.push_subscriptions", "42501")]),
      ...["authenticated", "anon"].flatMap((role) =>
        OTHER_TABLES.map((t) => asRole(role as "anon" | "authenticated", [probe(`${role}_${t}`, `select * from public.${t}`, "42501")], role === "authenticated" ? U1 : undefined)),
      ),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("a person reads only the five safe columns, and only their own row", () => {
      expect(r.res.safe_select).toBe("1");
    });
    it("endpoint, p256dh, auth, user_id, the time zone and * are not readable (42501)", () => {
      for (const k of ["select_endpoint", "select_user_id", "select_p256dh", "select_auth", "select_timezone", "select_star"]) expect(r.res[k], k).toBe("ok");
    });
    it("a person cannot insert or update (42501)", () => {
      expect(["insert_refused", "update_refused", "update_by_id_refused"].map((k) => r.res[k])).toEqual(["ok", "ok", "ok"]);
    });
    it("a delete filtered by user_id is refused (42501, because user_id is not selectable); a delete by id removes the person's own row and nobody else's", () => {
      expect(r.res.delete_filtered_by_user_id).toBe("ok");
      expect(r.res.delete_other_users_row).toBe("0");
      expect(r.res.other_row_untouched).toBe("1");
      expect(r.res.delete_own_row_by_id).toBe("1");
      expect(r.res.own_row_gone).toBe("0");
      expect(r.res.safe_select_after).toBe("0");
    });
    it("anonymous visitors can do nothing here, and neither they nor a signed-in person can touch the other six tables (42501)", () => {
      expect(r.res.anon_select).toBe("ok");
      expect(r.res.anon_delete).toBe("ok");
      for (const role of ["authenticated", "anon"]) for (const t of OTHER_TABLES) expect(r.res[`${role}_${t}`], `${role} ${t}`).toBe("ok");
    });
  });

  describe("row 9: push_subscriptions row security", () => {
    const body = [
      FIXTURES,
      deviceSql(D1, U1),
      deviceSql(D2, U2),
      scalar("rls_on", `select string_agg(relname || '=' || relrowsecurity, ',' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relname in ${IN_LIST}`),
      scalar("policies_push", `select string_agg(polname || ':' || polcmd::text || ':' || array_to_string(polroles::regrole[], ','), ' ' order by polname) from pg_policy where polrelid = 'public.push_subscriptions'::regclass`),
      scalar("policies_elsewhere", `select count(*) from pg_policy where polrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in ${IN_LIST}) and polrelid <> 'public.push_subscriptions'::regclass`),
      asRole("authenticated", [rowsOf("sees_own_only", "select id from public.push_subscriptions")], U1),
      asRole("authenticated", [rowsOf("other_person_sees_own_only", "select id from public.push_subscriptions")], U2),
      asRole("authenticated", [rowsOf("stranger_sees_none", "select id from public.push_subscriptions")], "00000000-0000-4000-8000-0000000000a9"),
      asRole("authenticated", [rowsOf("cannot_delete_others_by_id", `delete from public.push_subscriptions where id = '${D2}'`)], U1),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("row security is on for all seven tables", () => {
      expect(r.res.rls_on).toBe([...TABLES].sort().map((t) => `${t}=true`).join(","));
    });
    it("push_subscriptions has exactly two policies, select and delete, both for authenticated only; the other six tables have none", () => {
      expect(r.res.policies_push).toBe("push_subscriptions_delete_own:d:authenticated push_subscriptions_select_own:r:authenticated");
      expect(r.res.policies_elsewhere).toBe("0");
    });
    it("each person sees their own row and not another's; a stranger sees none; a delete cannot reach another person's row", () => {
      expect(r.res.sees_own_only).toBe("1");
      expect(r.res.other_person_sees_own_only).toBe("1");
      expect(r.res.stranger_sees_none).toBe("0");
      expect(r.res.cannot_delete_others_by_id).toBe("0");
    });
  });

  describe("row 11: a message is frozen once it leaves draft", () => {
    const upd = (set: string) => `update public.admin_messages set ${set} where id = '${M1}'`;
    const body = [
      FIXTURES,
      draftSql(M1),
      rowsOf("draft_edit_title", upd("title = 'Edited'")),
      rowsOf("draft_edit_kind", upd("kind = 'promotion'")),
      rowsOf("draft_edit_kind_back", upd("kind = 'service_announcement'")),
      rowsOf("draft_edit_link", upd("link_path = '/mentorship'")),
      rowsOf("leave_draft", upd("status = 'prepared', audience_count = 3")),
      rowsOf("noop_update_title", upd("title = title")),
      probe("frozen_title", upd("title = 'Changed'"), "P0001", "invalid_state"),
      probe("frozen_body", upd("body = 'Changed'"), "P0001", "invalid_state"),
      probe("frozen_channels", upd("channels = array['push']"), "P0001", "invalid_state"),
      probe("frozen_segment_key", upd("segment_key = 'seekers'"), "P0001", "invalid_state"),
      probe("frozen_segment_params", upd(`segment_params = '{"days":30}'`), "P0001", "invalid_state"),
      probe("frozen_consent_line", upd("consent_line = 'We asked'"), "P0001", "invalid_state"),
      probe("frozen_kind", upd("kind = 'promotion'"), "P0001", "invalid_state"),
      rowsOf("progress_status", upd("status = 'submitted'")),
      rowsOf("progress_counts", upd("sent_count = 2, failed_count = 1, skipped_count = 0")),
      rowsOf("progress_approver", upd(`approved_by = '${A2}', approved_by_email = 'a2@example.test', status = 'approved'`)),
      rowsOf("progress_started", upd("sent_started_at = now(), status = 'sending'")),
      probe("frozen_link_path", upd("link_path = '/jobs'"), "P0001", "invalid_state"),
      rowsOf("noop_update_link_path", upd("link_path = link_path")),
      scalar("title_after", `select title from public.admin_messages where id = '${M1}'`),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("while a draft, every field may be edited", () => {
      expect(["draft_edit_title", "draft_edit_kind", "draft_edit_kind_back", "draft_edit_link", "leave_draft"].map((k) => r.res[k])).toEqual(["1", "1", "1", "1", "1"]);
    });
    it("after the draft, title, body, link, channels, segment, consent line and kind cannot change (P0001, hint invalid_state)", () => {
      for (const k of ["frozen_title", "frozen_body", "frozen_link_path", "frozen_channels", "frozen_segment_key", "frozen_segment_params", "frozen_consent_line", "frozen_kind"]) expect(r.res[k], k).toBe("ok");
      expect(r.res.title_after).toBe("Edited");
    });
    it("what a send changes can still change: status, counts, the approver, the start time; and writing a value it already holds is not an edit", () => {
      for (const k of ["noop_update_title", "noop_update_link_path", "progress_status", "progress_counts", "progress_approver", "progress_started"]) expect(r.res[k], k).toBe("1");
    });
  });

  describe("row 12: deleting an admin succeeds (N1-R14 and R22)", () => {
    const body = [
      FIXTURES,
      draftSql(M1),
      `update public.admin_messages set status = 'prepared' where id = '${M1}';`,
      `update public.admin_messages set status = 'submitted' where id = '${M1}';`,
      `update public.admin_messages set approved_by = '${A2}', approved_by_email = 'a2@example.test', status = 'approved' where id = '${M1}';`,
      eventRow,
      changeRow,
      scalar("creator_before", `select created_by from public.admin_messages where id = '${M1}'`),
      rowsOf("delete_creator", `delete from public.admin_users where id = '${A1}'`),
      scalar("creator_after", `select coalesce(created_by::text, 'NULL') from public.admin_messages where id = '${M1}'`),
      scalar("creator_email_kept", `select created_by_email from public.admin_messages where id = '${M1}'`),
      rowsOf("delete_approver", `delete from public.admin_users where id = '${A2}'`),
      scalar("approver_after", `select coalesce(approved_by::text, 'NULL') || '/' || approved_by_email || '/' || status from public.admin_messages where id = '${M1}'`),
      scalar("events_kept", "select count(*) from public.admin_message_events"),
      scalar("event_actor_kept", `select actor_admin_id from public.admin_message_events limit 1`),
      scalar("changes_kept", "select count(*) from public.notification_setting_changes"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("deleting the creator succeeds and clears created_by; the email snapshot stays", () => {
      expect(r.res.delete_creator).toBe("1");
      expect(r.res.creator_after).toBe("NULL");
      expect(r.res.creator_email_kept).toBe("a1@example.test");
    });
    it("deleting the approver of an APPROVED message then succeeds too: approved_by is cleared, the email and the status stay, no immutability trigger or check blocks it", () => {
      expect(r.res.delete_approver).toBe("1");
      expect(r.res.approver_after).toBe("NULL/a2@example.test/approved");
    });
    it("the audit rows stay, with their actor id (there is no foreign key to clear)", () => {
      expect(r.res.events_kept).toBe("1");
      expect(r.res.event_actor_kept).toBe(A1);
      expect(r.res.changes_kept).toBe("1");
    });
  });

  describe("row 14: the two append-only tables (N1-R8)", () => {
    const refusals = (role: "service_role" | "postgres") =>
      ["admin_message_events", "notification_setting_changes"].flatMap((t) => [
        probe(`${role}_${t}_update`, `update public.${t} set actor_email = 'x'`, "42501"),
        probe(`${role}_${t}_delete`, `delete from public.${t}`, "42501"),
        probe(`${role}_${t}_truncate`, `truncate public.${t}`, "42501"),
      ]);
    const body = [
      FIXTURES,
      draftSql(M1),
      eventRow,
      changeRow,
      asRole("service_role", [
        rowsOf("service_reads_events", "select * from public.admin_message_events"),
        rowsOf("service_inserts_event", `insert into public.admin_message_events (message_id, event) values ('${M1}', 'prepared')`),
        rowsOf("service_inserts_change", "insert into public.notification_setting_changes (key, new_value) values ('mass_email_cap_24h', 70)"),
        ...refusals("service_role"),
      ]),
      ...refusals("postgres"),
      scalar("trigger_message", "select pg_temp.errtext('update public.admin_message_events set actor_email = ''x''')"),
      scalar("trigger_tables", `select string_agg(c.relname || ':' || t.tgname, ',' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ('admin_message_events', 'notification_setting_changes')`),
      scalar("service_can_update_events", "select has_table_privilege('service_role', 'public.admin_message_events', 'update')"),
      scalar("service_can_delete_events", "select has_table_privilege('service_role', 'public.admin_message_events', 'delete')"),
      scalar("service_can_update_changes", "select has_table_privilege('service_role', 'public.notification_setting_changes', 'update')"),
      scalar("service_can_delete_changes", "select has_table_privilege('service_role', 'public.notification_setting_changes', 'delete')"),
      scalar("events_intact", "select count(*) from public.admin_message_events"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("service_role can read and add rows", () => {
      expect(r.res.service_reads_events).toBe("1");
      expect(r.res.service_inserts_event).toBe("1");
      expect(r.res.service_inserts_change).toBe("1");
    });
    it("service_role holds no UPDATE or DELETE privilege on either table (insert-only under G1), so the refusal comes from the missing grant", () => {
      expect([r.res.service_can_update_events, r.res.service_can_delete_events, r.res.service_can_update_changes, r.res.service_can_delete_changes]).toEqual(["false", "false", "false", "false"]);
    });
    it("update, delete and truncate are refused with 42501 for service_role AND for the table's owner (the defence trigger)", () => {
      for (const role of ["service_role", "postgres"]) {
        for (const t of ["admin_message_events", "notification_setting_changes"]) {
          for (const verb of ["update", "delete", "truncate"]) expect(r.res[`${role}_${t}_${verb}`], `${role} ${verb} ${t}`).toBe("ok");
        }
      }
      expect(r.res.events_intact).toBe("2");
    });
    it("the refusal text is generic: it names no value from the row", () => {
      expect(r.res.trigger_message).not.toMatch(/secret|example|@/);
      expect(r.res.trigger_message.length).toBeGreaterThan(5);
    });
    it("each append-only table carries its row trigger and its truncate trigger", () => {
      expect(r.res.trigger_tables.split(",").length).toBe(4);
    });
  });

  describe("row 17: the exact grants, and the self-check that guards them", () => {
    const body = [grantMatrix(), columnGrants, functionAcl].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("every table has exactly the expected grants per role, nothing for anon or PUBLIC, and no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN for anyone", () => {
      for (const t of TABLES) expect(r.res[`grants_${t}`], t).toBe(EXPECTED_GRANTS[t]);
    });
    it("the two trigger functions are executable by nobody but their owner (not PUBLIC, anon, authenticated or service_role)", () => {
      expect(r.res.function_execute).toBe("none");
    });
    it("a person's only column privilege is SELECT on the five safe columns of push_subscriptions; no other column carries a column-level grant", () => {
      expect(r.res.safe_columns).toBe(SAFE_COLUMNS);
      expect(r.res.column_grants_elsewhere).toBe("0");
    });

    describe("the self-check raises on a missing grant, an extra grant and a missing control", () => {
      const forward = readMigration(F0265);
      const withEdit = (from: string, to: string) => {
        if (forward.split(from).length !== 2) throw new Error(`anchor not found exactly once: ${from.slice(0, 60)}`);
        return forward.replace(from, to);
      };
      const applyFails = (edited: string) => {
        const res = replay0265("select 1;", { forward: edited });
        return { ok: res.ok, mentionsSelfCheck: /0265 self-check/.test(res.stderr), stderr: res.stderr };
      };

      it("control: the unedited file applies", () => expect(replay0265("select 1;").ok).toBe(true));
      it.each([
        ["a service_role grant removed", "grant select, insert, update, delete on public.notification_deliveries to service_role;", ""],
        ["SELECT granted to anon", "do $check$", "grant select on public.notification_settings to anon;\ndo $check$"],
        ["TRUNCATE granted to authenticated", "do $check$", "grant truncate on public.notification_deliveries to authenticated;\ndo $check$"],
        ["a privilege granted to PUBLIC", "do $check$", "grant select on public.admin_messages to public;\ndo $check$"],
        ["REFERENCES granted to service_role", "do $check$", "grant references on public.admin_message_events to service_role;\ndo $check$"],
        ["a column the person must not read is granted", "do $check$", "grant select (endpoint) on public.push_subscriptions to authenticated;\ndo $check$"],
        ["UPDATE granted to service_role on an append-only table", "do $check$", "grant update on public.admin_message_events to service_role;\ndo $check$"],
        ["row security turned off", "do $check$", "alter table public.admin_messages disable row level security;\ndo $check$"],
        ["a policy added to a service-only table", "do $check$", "create policy extra on public.admin_messages for select to authenticated using (true);\ndo $check$"],
        ["the own-row delete policy removed", "do $check$", "drop policy push_subscriptions_delete_own on public.push_subscriptions;\ndo $check$"],
        ["EXECUTE on the claim function granted to anon", "do $check$", "grant execute on function public.claim_notification(uuid, text, uuid, text, uuid, interval) to anon;\ndo $check$"],
        ["EXECUTE on the release function granted to authenticated", "do $check$", "grant execute on function public.release_notification(uuid, text) to authenticated;\ndo $check$"],
        ["EXECUTE on the prune function left to PUBLIC", "do $check$", "grant execute on function public.prune_notification_deliveries(integer) to public;\ndo $check$"],
        ["the quiet-hours predicate made executable by service_role", "do $check$", "grant execute on function public.notification_in_quiet_hours(timestamptz, text) to service_role;\ndo $check$"],
        ["the claim function loses its service_role grant", "grant execute on function public.claim_notification(uuid, text, uuid, text, uuid, interval) to service_role;\n", ""],
        ["the unread-count function loses its service_role grant", "grant execute on function public.unread_notification_count(uuid) to service_role;\n", ""],
        ["a function made STRICT", "language plpgsql\nsecurity invoker\nset search_path = ''\nas $mark$", "language plpgsql\nstrict\nsecurity invoker\nset search_path = ''\nas $mark$"],
        ["a function without a pinned search_path", "language plpgsql\nsecurity invoker\nset search_path = ''\nas $mark$", "language plpgsql\nsecurity invoker\nas $mark$"],
      ])("%s: the apply fails and says so", (_name, from, to) => {
        const result = applyFails(withEdit(from, to));
        expect(result.ok, result.stderr).toBe(false);
        expect(result.mentionsSelfCheck, result.stderr).toBe(true);
      });
    });
  });

  describe("row 19: the same result with the platform's automatic grants switched off (simulation, stated limits)", () => {
    const probeTable = "create table public.n1_default_grants_probe (id int);";
    const probeGrants = scalar("probe_grants", `select coalesce(string_agg(distinct g.rolname, ',' order by g.rolname), 'none') from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a join pg_roles g on g.oid = a.grantee where c.relname = 'n1_default_grants_probe' and g.rolname in ('anon', 'authenticated', 'service_role')`);
    const on = replay0265([probeTable, probeGrants, grantMatrix(), columnGrants].join("\n"));
    const off = replay0265([probeTable, probeGrants, grantMatrix(), columnGrants].join("\n"), { prelude: NO_DEFAULT_GRANTS });

    it("control: with the defaults ON, a new table does get grants for the three roles", () => {
      expect(on.ok, on.stderr).toBe(true);
      expect(on.res.probe_grants).toBe("anon,authenticated,service_role");
    });
    it("the simulation works: with the defaults OFF, a new table gets none", () => {
      expect(off.ok, off.stderr).toBe(true);
      expect(off.res.probe_grants).toBe("none");
    });
    it("with the defaults OFF the migration still applies, its self-check passes, and the grants are exactly the same", () => {
      for (const t of TABLES) expect(off.res[`grants_${t}`], t).toBe(EXPECTED_GRANTS[t]);
      expect(off.res.safe_columns).toBe(SAFE_COLUMNS);
      expect(off.res.column_grants_elsewhere).toBe("0");
    });
    it("a migration that leaned on the defaults would fail there: the file minus one explicit grant does not apply under the simulation", () => {
      const forward = readMigration(F0265);
      const anchor = "grant select, insert, update, delete on public.notification_deliveries to service_role;";
      expect(forward.split(anchor).length).toBe(2);
      const res = replay0265("select 1;", { forward: forward.replace(anchor, ""), prelude: NO_DEFAULT_GRANTS });
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/0265 self-check/);
    });
  });

  describe("the part-1 rollback", () => {
    const rollback = readRollback(R0265);
    const body = [
      FIXTURES,
      draftSql(M1),
      deviceSql(D1, U1),
      scalar("functions_before", `select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('notification_in_quiet_hours', 'claim_notification', 'release_notification', 'mark_notification_sent', 'stale_notification_claims', 'resolve_stale_claim', 'unread_notification_count', 'prune_notification_deliveries', 'notification_guard_append_only', 'notification_guard_message_edit')`),
      scalar("tables_before", `select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ${IN_LIST}`),
      rollback,
      rollback,
      scalar("tables_after", `select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ${IN_LIST}`),
      scalar("functions_after", `select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('notification_in_quiet_hours', 'claim_notification', 'release_notification', 'mark_notification_sent', 'stale_notification_claims', 'resolve_stale_claim', 'unread_notification_count', 'prune_notification_deliveries', 'notification_guard_append_only', 'notification_guard_message_edit')`),
      scalar("policies_after", `select count(*) from pg_policy where polrelid not in (select oid from pg_class where relnamespace <> 'public'::regnamespace) and polname like 'push_subscriptions_%'`),
      scalar("other_objects_untouched", "select (to_regclass('public.profiles') is not null and to_regclass('public.admin_users') is not null and to_regclass('public.email_preferences') is not null)::text"),
    ].join("\n");
    const r = replay0265(body);

    it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
    it("removes all seven tables and all ten functions, runs twice without error, and touches nothing else", () => {
      expect(r.res.tables_before).toBe("7");
      expect(r.res.functions_before).toBe("10");
      expect(r.res.tables_after).toBe("0");
      expect(r.res.functions_after).toBe("0");
      expect(r.res.policies_after).toBe("0");
      expect(r.res.other_objects_untouched).toBe("true");
    });
  });

  describe("the file itself", () => {
    const forward = readMigration(F0265);
    it("never names the new permission label as the enum type (it reads permissions at call time, after 0264 has committed)", () => {
      expect(usesNewValueAsEnum(forward, "user_messaging")).toBe(false);
    });
    it("has no transaction control of its own (the runner wraps the file)", () => {
      expect(forward.replace(/--.*$/gm, "")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    });
    it("ends with the self-check, after every statement that changes anything", () => {
      const code = forward.replace(/--.*$/gm, "");
      const at = code.lastIndexOf("do $check$");
      expect(at).toBeGreaterThan(0);
      expect(code.slice(at)).not.toMatch(/\b(create|alter|drop|grant|revoke|insert)\s/i);
    });
  });
});
