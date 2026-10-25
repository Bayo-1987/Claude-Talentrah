/**
 * 0273 part A AS APPLIED to the database under test: the real tables, one rolled-back transaction, no DDL. It fails (never skips) when 0273 is not applied.
 * What it adds to the replay tests: the same rules against the real admin_users, profiles, auth.users and the real default privileges of the platform.
 */
import { describe, expect, it } from "vitest";
import { A2, FIXTURES, M1, U1, applied0265, asRole, probe, rowsOf, scalar } from "./migration-0265-support";
import { A3, FLAGS_ON, OPERATORS, msg } from "./migration-0265-admin-support";

const lit = (v: string) => `'${v}'`;
describe("0273 part A on the real schema (rolled back, no DDL)", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    "create temp table n1_ids (k text primary key, id uuid);",
    "grant all on n1_ids to service_role;",
    scalar("migration_recorded", "select count(*) from supabase_migrations.schema_migrations where version = '0273'"),
    asRole("service_role", [
      `insert into n1_ids select 'm', public.create_admin_message(${lit(A2)}, 'service_announcement', 'T', 'B', null, array['inapp'], 'self_test', '{}'::jsonb, null, false);`,
      `select public.prepare_admin_message((select id from n1_ids where k = 'm'), ${lit(A3)}, 500);`,
      `select public.start_admin_message_send((select id from n1_ids where k = 'm'), ${lit(A2)});`,
      `select public.record_admin_message_progress((select id from n1_ids where k = 'm'), 1, 0, 0);`,
      `select public.finish_admin_message_send((select id from n1_ids where k = 'm'));`,
      probe("insert_message", "insert into public.admin_messages (kind, title, body, channels, segment_key, created_by_email) values ('service_announcement', 't', 'b', array['inapp'], 'self_test', 'x@example.test')", "42501"),
      probe("update_message", `update public.admin_messages set status = 'approved' where id = (select id from n1_ids where k = 'm')`, "42501"),
      probe("insert_event", `insert into public.admin_message_events (message_id, event) values ((select id from n1_ids where k = 'm'), 'approved')`, "42501"),
      probe("ledger_insert", `insert into public.notification_deliveries (user_id, kind, subject_id, channel) values (${lit(U1)}, 'match_alert', gen_random_uuid(), 'inapp')`, "42501"),
      probe("ledger_delete", "delete from public.notification_deliveries", "42501"),
    ]),
    scalar("walked", "select status || '/' || sent_count from public.admin_messages where id = (select id from n1_ids where k = 'm')"),
    // the guard on the real table: an illegal move and a frozen field
    msg(M1, { status: "sent", approval: false, started: "1 hour" }),
    probe("sent_cannot_reopen", `update public.admin_messages set status = 'sending' where id = ${lit(M1)}`, "P0001", "invalid_state"),
    probe("creator_frozen", `update public.admin_messages set created_by_email = 'x@example.test' where id = ${lit(M1)}`, "P0001", "invalid_state"),
    rowsOf("delete_admin_clears_creator", `delete from public.admin_users where id = ${lit(A2)}`),
    scalar("creator_after", "select count(*) from public.admin_messages where created_by is null and id = (select id from n1_ids where k = 'm')"),
  ].join("\n");
  const r = applied0265(body);
  it("the transaction ran and 0273 is in the migration ledger", () => {
    expect(r.ok, r.stderr).toBe(true);
    expect(r.res.migration_recorded).toBe("1");
  });
  it("the service role runs create, prepare, start, progress and finish on the real tables and cannot write the tables by hand", () => {
    expect(r.res.walked).toBe("sent/1");
    for (const k of ["insert_message", "update_message", "insert_event", "ledger_insert", "ledger_delete"]) expect(r.res[k], k).toBe("ok");
  });
  it("the guard holds on the real table, and deleting an admin still clears created_by", () => {
    expect([r.res.sent_cannot_reopen, r.res.creator_frozen]).toEqual(["ok", "ok"]);
    expect([r.res.delete_admin_clears_creator, r.res.creator_after]).toEqual(["1", "1"]);
  });
});
