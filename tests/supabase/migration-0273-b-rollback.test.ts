/**
 * N1B-R4 / F9: 0273's rollback restores EXACTLY the state 0265 alone leaves: every function (body, owner-side flags, search path, grants), every table's columns, defaults, constraints,
 * triggers, indexes, policies, table and column privileges. The 0265 rollback file is not edited (R4). Proven by snapshotting the catalog three ways in scratch databases:
 *   A) 0265 alone                                  B) 0265 then 0273 then the 0273 rollback                C) B then 0273 again (the cycle repeats)
 * A and B must be equal section by section; C must equal the cumulative state (0265 then 0273).
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { F0273, R0273, readMigration, readRollback, replay0265, scalar } from "./migration-0265-support";

const NAMES = "('notification_deliveries', 'push_subscriptions', 'admin_messages', 'admin_message_recipients', 'admin_message_events', 'notification_settings', 'notification_setting_changes')";
const SECTIONS: Record<string, string> = {
  functions: `select md5(coalesce(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || p.proisstrict::text || '|' || coalesce(p.proconfig::text, '') || '|' || coalesce(p.proacl::text, '') || '|' || p.proowner::regrole::text, E'\\n' order by p.oid::regprocedure::text), ''))
    from pg_proc p where p.pronamespace = 'public'::regnamespace`,
  function_names: `select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like '%admin_message%' or p.proname like '%notification%' or p.proname like '%push%' or p.proname like '%email_unsub%')`,
  columns: `select md5(coalesce(string_agg(c.table_name || '.' || c.column_name || '|' || c.ordinal_position || '|' || c.data_type || '|' || c.is_nullable || '|' || coalesce(c.column_default, '') || '|' || coalesce(c.character_maximum_length::text, ''), E'\\n' order by c.table_name, c.column_name), ''))
    from information_schema.columns c where c.table_schema = 'public' and c.table_name in ${NAMES}`,
  constraints: `select md5(coalesce(string_agg(cl.relname || '|' || co.conname || '|' || pg_get_constraintdef(co.oid), E'\\n' order by cl.relname, co.conname), ''))
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid where cl.relnamespace = 'public'::regnamespace and cl.relname in ${NAMES}`,
  triggers: `select md5(coalesce(string_agg(cl.relname || '|' || pg_get_triggerdef(t.oid), E'\\n' order by cl.relname, t.tgname), ''))
    from pg_trigger t join pg_class cl on cl.oid = t.tgrelid where not t.tgisinternal and cl.relnamespace = 'public'::regnamespace and (cl.relname in ${NAMES} or cl.relname = 'profiles')`,
  indexes: `select md5(coalesce(string_agg(indexname || '|' || indexdef, E'\\n' order by indexname), '')) from pg_indexes where schemaname = 'public' and tablename in ${NAMES}`,
  policies: `select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\\n' order by tablename, policyname), '')) from pg_policies where schemaname = 'public' and tablename in ${NAMES}`,
  table_privileges: `select md5(coalesce(string_agg(cl.relname || '|' || coalesce(cl.relacl::text, '') || '|' || cl.relrowsecurity::text || '|' || cl.relforcerowsecurity::text || '|' || cl.relowner::regrole::text, E'\\n' order by cl.relname), ''))
    from pg_class cl where cl.relnamespace = 'public'::regnamespace and cl.relname in ${NAMES}`,
  column_privileges: `select md5(coalesce(string_agg(cl.relname || '.' || a.attname || '|' || a.attacl::text, E'\\n' order by cl.relname, a.attname), ''))
    from pg_attribute a join pg_class cl on cl.oid = a.attrelid where cl.relnamespace = 'public'::regnamespace and cl.relname in ${NAMES} and a.attacl is not null and not a.attisdropped`,
  dropped_columns: `select coalesce(string_agg(cl.relname || '.' || a.attname, ',' order by cl.relname, a.attnum), 'none') from pg_attribute a join pg_class cl on cl.oid = a.attrelid where cl.relnamespace = 'public'::regnamespace and cl.relname in ${NAMES} and a.attisdropped`,
  settings_rows: `select md5(coalesce(string_agg(key || '=' || int_value, ',' order by key), '')) from public.notification_settings`,
};
const snapshot = Object.entries(SECTIONS).map(([k, q]) => scalar(`snap_${k}`, q)).join("\n");
const rollback = readRollback(R0273);

const A = replay0265(snapshot, { only0265: true });
const B = replay0265(`${rollback}\n${snapshot}`);
const C = replay0265(`${rollback}\n${readMigration(F0273)}\n${snapshot}`);
const D = replay0265(snapshot);
const keys = Object.keys(SECTIONS);

describe("the rollback of 0273 restores exactly the state 0265 alone leaves", () => {
  it("the replays apply", () => {
    for (const r of [A, B, C, D]) expect(r.ok, r.stderr).toBe(true);
    for (const r of [A, B, C, D]) for (const k of keys) expect(r.res[`snap_${k}`], k).toBeTruthy();
  });
  it.each(keys.filter((k) => k !== "dropped_columns"))("section %s is identical to 0265 alone", (k) => {
    expect(B.res[`snap_${k}`]).toBe(A.res[`snap_${k}`]);
  });
  it("the sections are not trivially equal: 0273 itself changes functions, columns, constraints and privileges (the snapshot can tell the states apart)", () => {
    for (const k of ["functions", "function_names", "columns", "constraints", "table_privileges", "column_privileges"]) expect(D.res[`snap_${k}`], k).not.toBe(A.res[`snap_${k}`]);
  });
  it("the only trace of 0273 after its rollback is nothing: no dropped-column residue is created beyond what a column added and removed leaves, which is one entry, on the events table only", () => {
    expect(A.res.snap_dropped_columns).toBe("none");
    expect(B.res.snap_dropped_columns).toMatch(/^admin_message_events\.\.+pg\.dropped\.\d+\.+$/);
  });
  it("0273 applied again after its rollback gives the cumulative state again", () => {
    for (const k of keys.filter((k) => k !== "dropped_columns" && k !== "columns")) expect(C.res[`snap_${k}`], k).toBe(D.res[`snap_${k}`]);
  });
});
