/**
 * Migration 0265 part 4 AS APPLIED to the database under test: the admin-message functions run against the REAL profiles, organisations, admin tables, auth.users and QA test, in one
 * transaction that is rolled back and contains no DDL (so it takes only row locks and never waits for another suite). The replay tests prove the logic against stand-ins; this proves that
 * every column the functions name exists on the real tables and that the same outcomes come back.
 *
 * Nothing here asserts a count of "everyone": the real tables hold other suites' people. The people made here carry a country no one else has, so a segment on that country is exact.
 *
 * It FAILS, and does not skip, when 0265 has not been applied to the database under test.
 */
import { describe, expect, it } from "vitest";
import { A2, A1, FIXTURES, M1, U1, U2, applied0265, personSql, scalar } from "./migration-0265-support";
import { A3, A4, FLAGS_ON, OPERATORS, call, idList, ids, msg, sel } from "./migration-0265-admin-support";

const MARK = "N1-AppliedLand";
const E1 = "00000000-0000-4000-8000-00000000f101";
const DEL = "00000000-0000-4000-8000-00000000f102";
const ORG_UNVERIFIED = "00000000-0000-4000-8000-00000000f1a1";
const ORG_VERIFIED = "00000000-0000-4000-8000-00000000f1a2";
const D1 = "00000000-0000-4000-8000-00000000f1d1";

describe("the admin-message functions on the real schema (rolled back, no DDL)", () => {
  const body = [
    FIXTURES,
    OPERATORS,
    FLAGS_ON,
    personSql(E1),
    personSql(DEL),
    // U1: recent, confirmed address, push on with a device; U2: inactive 45 days; E1: member of a verified organisation; DEL: pending deletion
    `update public.profiles set country = '${MARK}', last_active_at = now() where id = '${U1}';`,
    `update public.profiles set country = '${MARK}', last_active_at = now() - interval '45 days' where id = '${U2}';`,
    `update public.profiles set country = '${MARK}', last_active_at = now() where id = '${E1}';`,
    `update public.profiles set country = '${MARK}', deletion_requested_at = now() where id = '${DEL}';`,
    `update auth.users set email_confirmed_at = now() where id in ('${U1}', '${U2}', '${E1}');`,
    `insert into public.organizations (id, name, verified, created_by) values ('${ORG_UNVERIFIED}', 'N1 applied one', false, '${U1}'), ('${ORG_VERIFIED}', 'N1 applied two', true, '${U1}');`,
    `insert into public.organization_members (organization_id, user_id, role) values ('${ORG_VERIFIED}', '${E1}', 'owner');`,
    `update public.email_preferences set push_enabled = true where user_id = '${U1}';`,
    `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short) values ('${D1}', '${U1}', 'https://push.example.invalid/applied', 'k', 'a', 'Chrome');`,
    scalar("seg_country", ids(call.resolve("country", `{"country":"${MARK.toLowerCase()}"}`, A2))),
    scalar("seg_self", ids(call.resolve("self_test", "{}", A2))),
    scalar("seg_employers_has_e1", `select exists (select 1 from ${call.resolve("employers", "{}", A2)} s where s = '${E1}')::text`),
    scalar("seg_verified_has_e1", `select exists (select 1 from ${call.resolve("verified_employers", "{}", A2)} s where s = '${E1}')::text`),
    scalar("seg_seekers_has_u1_not_e1", `select (exists (select 1 from ${call.resolve("seekers", "{}", A2)} s where s = '${U1}') and not exists (select 1 from ${call.resolve("seekers", "{}", A2)} s where s = '${E1}'))::text`),
    scalar("seg_inactive", `select (exists (select 1 from ${call.resolve("inactive_seekers", '{"days":30}', A2)} s where s = '${U2}') and not exists (select 1 from ${call.resolve("inactive_seekers", '{"days":30}', A2)} s where s = '${U1}'))::text`),
    scalar("seg_since", `select (exists (select 1 from ${call.resolve("signed_up_since", '{"since":"2020-01-01"}', A2)} s where s = '${U1}'))::text`),
    scalar("seg_everyone_has_u1_not_del", `select (exists (select 1 from ${call.resolve("everyone", "{}", A2)} s where s = '${U1}') and not exists (select 1 from ${call.resolve("everyone", "{}", A2)} s where s = '${DEL}'))::text`),
    // prepare, submit, approve and start on the real tables
    msg(M1, { key: "country", params: `{"country":"${MARK}"}`, channels: "array['inapp','push','email']", approval: true }),
    scalar("prepared_count", sel(call.prepare(M1, A2))),
    scalar("recipient_flags", `select string_agg(right(user_id::text, 4) || '=' || to_inapp::int || to_push::int || to_email::int, ',' order by user_id) from public.admin_message_recipients where message_id = '${M1}'`),
    `select ${call.submit(M1, A2)};`,
    `select ${call.approve(M1, A3, "service_announcement")};`,
    scalar("started", `select (${call.start(M1, A2)} = '${M1}')::text`),
    scalar("events", `select string_agg(event, ',' order by event) from ${call.audit(A2, M1)} e`),
    // the eligibility filter and the settings, on the real tables
    scalar("eligible", `select coalesce(string_agg(s::text, ',' order by s), 'none') from ${call.eligible(`array['${U1}', '${DEL}']::uuid[]`, "announcements")} s`),
    `select ${call.setting("mass_email_cap_24h", 77, A4)};`,
    scalar("setting", "select int_value || '/' || updated_by_email from public.notification_settings where key = 'mass_email_cap_24h'"),
    scalar("setting_log", "select count(*) from public.notification_setting_changes where new_value = 77"),
    // the real QA test is the one the segments call
    scalar("qa_fn", "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'is_qa_account'"),
    // A1 holds nothing: refused
    scalar("noperm", `select pg_temp.expect('${sel(call.prepare(M1, A1)).replace(/'/g, "''")}', '42501')`),
  ].join("\n");
  const r = applied0265(body);

  it("the transaction ran", () => expect(r.ok, r.stderr).toBe(true));
  it("every segment runs on the real columns and answers as it does on the stand-ins", () => {
    expect(r.res.seg_country).toBe(idList(U1, U2, E1));
    expect(r.res.seg_self).toBe(A2);
    for (const k of ["seg_employers_has_e1", "seg_verified_has_e1", "seg_seekers_has_u1_not_e1", "seg_inactive", "seg_since", "seg_everyone_has_u1_not_del"]) expect(r.res[k], k).toBe("true");
  });
  it("prepare queues the three people with the right flags (U1 has push and a confirmed address; U2 is inactive; E1 has neither a device nor push on) and the count equals the rows", () => {
    expect(r.res.prepared_count).toBe("3");
    expect(r.res.recipient_flags).toBe("00a1=111,00a2=100,f101=101");
  });
  it("submit, approve by another operator and start run on the real tables and leave their audit events", () => {
    expect(r.res.started).toBe("true");
    expect(r.res.events).toBe("approved,prepared,send_started,submitted");
  });
  it("the eligibility filter, the setting and its log work on the real tables; the QA test they call exists", () => {
    expect(r.res.eligible).toBe(U1);
    expect(r.res.setting).toBe(`77/${A4}@example.test`);
    expect(r.res.setting_log).toBe("1");
    expect(r.res.qa_fn).toBe("1");
  });
  it("an operator with no permission is refused on the real tables too", () => expect(r.res.noperm).toBe("ok"));
});
