/**
 * Fixtures and call builders shared by the admin-message tests of migration 0265 (the function tests and the event-detail test). No test lives here.
 */
import { A2, adminSql, grantPermissionSql } from "./migration-0265-support";

export const A3 = "00000000-0000-4000-8000-0000000000b3";
export const A4 = "00000000-0000-4000-8000-0000000000b4";
export const ROLE_A3 = "00000000-0000-4000-8000-0000000000ea";
export const ROLE_A4 = "00000000-0000-4000-8000-0000000000eb";
export const M3 = "00000000-0000-4000-8000-0000000000c3";
export const M4 = "00000000-0000-4000-8000-0000000000c4";
export const M5 = "00000000-0000-4000-8000-0000000000c5";
export const M6 = "00000000-0000-4000-8000-0000000000c6";
export const UNKNOWN = "00000000-0000-4000-8000-0000000000ee";
export const P = (n: number) => `00000000-0000-4000-8000-00000000f0${String(n).padStart(2, "0")}`;

/** Two operators who may message, one who may only change the settings, one with nothing. A1 has no permission; A2 and A3 hold user_messaging; A4 holds operators. */
export const OPERATORS = [adminSql(A3), adminSql(A4), grantPermissionSql(A2), grantPermissionSql(A3, "user_messaging", ROLE_A3), grantPermissionSql(A4, "operators", ROLE_A4)].join("\n");
export const FLAGS_ON = "update public.feature_flags set enabled = true where key in ('notifications_master', 'admin_messaging', 'admin_promotions', 'admin_email');";
export const flag = (key: string, on: boolean) => `update public.feature_flags set enabled = ${on} where key = '${key}';`;

export type Msg = {
  by?: string | null;
  kind?: "service_announcement" | "promotion";
  channels?: string;
  key?: string;
  params?: string;
  consent?: string | null;
  status?: string;
  approval?: boolean;
  approver?: string | null;
  started?: string | null;
  /** The creator's address as snapshotted on the row; by default it is derived from the creator (the admin fixtures use `<id>@example.test`), so two creators never share one. */
  email?: string;
};
export const lit = (v: string | null | undefined) => (v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`);
export const msg = (id: string, o: Msg = {}) => {
  const kind = o.kind ?? "service_announcement";
  const by = o.by === undefined ? A2 : o.by;
  const consent = o.consent === undefined ? (kind === "promotion" ? "You asked for offers from Talentrah." : null) : o.consent;
  return `insert into public.admin_messages (id, created_by, created_by_email, kind, title, body, channels, segment_key, segment_params, consent_line, status, requires_approval, approved_by, approved_by_email, sent_started_at) values ('${id}', ${lit(by)}, ${lit(o.email ?? (by ? `${by}@example.test` : "creator@example.test"))}, '${kind}', 'Title', 'Body', ${o.channels ?? "array['inapp']"}, '${o.key ?? "self_test"}', '${o.params ?? "{}"}'::jsonb, ${lit(consent)}, '${o.status ?? "draft"}', ${o.approval ?? true}, ${lit(o.approver)}, ${o.approver ? "'approver@example.test'" : "null"}, ${o.started ? `now() - interval '${o.started}'` : "null"});`;
};
export const call = {
  resolve: (key: string | null, params: string | null, actor: string | null) => `public.resolve_admin_segment(p_key => ${lit(key)}, p_params => ${params === null ? "null" : `'${params}'::jsonb`}, p_actor => ${lit(actor)})`,
  prepare: (m: string, actor: string | null, max: string | number = 500) => `public.prepare_admin_message(p_message => '${m}', p_actor => ${lit(actor)}, p_max_audience => ${max})`,
  submit: (m: string, actor: string | null) => `public.submit_admin_message(p_message => '${m}', p_actor => ${lit(actor)})`,
  approve: (m: string, actor: string | null, kind: string | null) => `public.approve_admin_message(p_message => '${m}', p_actor => ${lit(actor)}, p_kind_confirmed => ${lit(kind)})`,
  cancel: (m: string, actor: string | null) => `public.cancel_admin_message(p_message => '${m}', p_actor => ${lit(actor)})`,
  start: (m: string, actor: string | null) => `public.start_admin_message_send(p_message => '${m}', p_actor => ${lit(actor)})`,
  audit: (actor: string | null, m?: string | null) => `public.admin_message_audit(p_actor => ${lit(actor)}${m === undefined ? "" : `, p_message => ${lit(m)}`})`,
  test: (m: string, actor: string | null) => `public.record_admin_message_test(p_message => '${m}', p_actor => ${lit(actor)})`,
  setting: (key: string | null, value: string | number | null, actor: string | null) => `public.set_notification_setting(p_key => ${lit(key)}, p_value => ${value}, p_actor => ${lit(actor)})`,
  pause: (m: string, reason: string | null) => `public.pause_admin_message_send(p_message => '${m}', p_reason => ${lit(reason)})`,
  resume: (m: string, actor: string | null) => `public.resume_admin_message_send(p_message => '${m}', p_actor => ${lit(actor)})`,
  eligible: (ids: string, stream: string | null) => `public.admin_email_eligible_recipients(p_user_ids => ${ids}, p_stream => ${lit(stream)})`,
};
export const sel = (c: string) => `select ${c}`;
export const idList = (...ids: string[]) => ids.slice().sort().join(",");
export const ids = (c: string) => `select coalesce(string_agg(s::text, ',' order by s), 'none') from ${c} s`;

