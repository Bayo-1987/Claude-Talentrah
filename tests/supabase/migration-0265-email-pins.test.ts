/**
 * The email-pins addendum v4, tests (a), (c) and (d): the catalogue is read, never trusted from the file's text.
 *
 *   (a) no email-like column on any table the migration CREATES, nor on any column it ADDS to an existing table, except two closed reviewed lists; every list-2 column is a closed type
 *   (c) the delivery ledger, the recipients table and the devices table gain no email-like column
 *   (d) every text, varchar or jsonb column (and arrays of them) is on the closed reviewed list D, and every column named like a failure, error, reason, outcome or status is closed
 *
 * The lists below are the Reviewer's, copied from the addendum; the builder does not add to them. A column the migration adds to an existing table is found by comparing the table's columns
 * before the migration (a snapshot taken in the replay's prelude) with its columns after. Test (b), on the event detail, is in the admin-message part. Replayed in a private scratch database.
 */
import { describe, expect, it } from "vitest";
import { replay0265, scalar } from "./migration-0265-support";

const CREATED = ["notification_deliveries", "push_subscriptions", "admin_messages", "admin_message_recipients", "admin_message_events", "notification_settings", "notification_setting_changes"] as const;
const IN_LIST = `array[${CREATED.map((t) => `'${t}'`).join(", ")}]`;
const NAME_RULE = /(email|e_mail|mail_address|address|recipient)/i;

/** LIST 1: the five reviewed OPERATOR columns (operator addresses, kept by OP-ADDR-1). */
const LIST_1 = ["admin_messages.created_by_email", "admin_messages.approved_by_email", "admin_message_events.actor_email", "notification_settings.updated_by_email", "notification_setting_changes.actor_email"];
/** LIST 2: reviewed NON-ADDRESS columns that legitimately match the name rule. */
const LIST_2 = ["admin_message_recipients.to_email", "admin_message_recipients.email_outcome", "email_preferences.email_promotions", "email_preferences.email_announcements"];

/** LIST D: every text, varchar or jsonb column (and arrays of them), with the reason. */
const LIST_D: Record<string, string> = {
  "notification_deliveries.kind": "text, CHECK in a closed list of four kinds",
  "notification_deliveries.channel": "text, CHECK in inapp, push, email",
  "push_subscriptions.endpoint": "text, credential-like push endpoint; never logged",
  "push_subscriptions.p256dh": "text, credential-like key",
  "push_subscriptions.auth": "text, credential-like secret",
  "push_subscriptions.ua_short": "text, browser and OS family only, max 40 characters",
  "push_subscriptions.timezone": "text, an IANA zone name",
  "push_subscriptions.revoke_reason": "text, CHECK in gone, user, kill, deleted, bad_key",
  "admin_messages.kind": "text, CHECK in service_announcement, promotion",
  "admin_messages.title": "text, OPERATOR-TYPED, the owner-accepted known limit, max 80",
  "admin_messages.body": "text, OPERATOR-TYPED, the owner-accepted known limit, max 500",
  "admin_messages.link_path": "text, a validated same-origin path",
  "admin_messages.channels": "text[], CHECK subset of inapp, push, email",
  "admin_messages.segment_key": "text, a key from the closed segment list",
  "admin_messages.segment_params": "jsonb, closed parameters of the closed segments; rule (b) applies",
  "admin_messages.consent_line": "text, snapshot of approved consent wording",
  "admin_messages.status": "text, CHECK in a closed status list",
  "admin_messages.kind_confirmed_by_approver": "text, equals the stored kind",
  "admin_message_recipients.push_outcome": "text, CHECK in the closed outcome set",
  "admin_message_recipients.email_outcome": "text, CHECK in the closed outcome set; also on list 2 of test (a)",
  "admin_message_events.event": "text, CHECK in the closed event list",
  "admin_message_events.detail": "jsonb, closed keys kind_confirmed and resolution; rule (b) applies",
  "notification_settings.key": "text primary key, the closed setting keys",
  "admin_messages.created_by_email": "operator address kept by OP-ADDR-1",
  "admin_messages.approved_by_email": "operator address kept by OP-ADDR-1",
  "admin_message_events.actor_email": "operator address kept by OP-ADDR-1",
  "notification_settings.updated_by_email": "operator address kept by OP-ADDR-1",
  "notification_setting_changes.actor_email": "operator address kept by OP-ADDR-1",
  "notification_setting_changes.key": "text; a foreign key to notification_settings(key)",
};

const PRE = "create temp table n1_pre_cols as select column_name::text as column_name from information_schema.columns where table_schema = 'public' and table_name = 'email_preferences';";
const body = [
  scalar("all_cols", `select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name, '~' order by table_name, column_name) from information_schema.columns where table_schema = 'public' and table_name = any (${IN_LIST})`),
  scalar("added_to_prefs", "select string_agg('email_preferences.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), '~' order by c.column_name) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'email_preferences' and c.column_name not in (select column_name from n1_pre_cols)"),
  scalar("added_types", "select string_agg('email_preferences.' || c.column_name || ':' || c.data_type, ' ' order by c.column_name) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'email_preferences' and c.column_name not in (select column_name from n1_pre_cols)"),
  scalar("checks", `select string_agg(conrelid::regclass::text || '|' || pg_get_constraintdef(oid), ' ## ') from pg_constraint where contype = 'c' and conrelid = any (array[${CREATED.map((t) => `'public.${t}'::regclass`).join(", ")}])`),
  scalar("key_fk", "select string_agg(confrelid::regclass::text, ',') from pg_constraint where contype = 'f' and conrelid = 'public.notification_setting_changes'::regclass and conkey = (select array_agg(attnum) from pg_attribute where attrelid = 'public.notification_setting_changes'::regclass and attname = 'key')"),
].join("\n");
const r = replay0265(body, { prelude: PRE });

type Col = { table: string; column: string; dataType: string; udt: string };
const parse = (s: string | undefined): Col[] =>
  (s ?? "")
    .split("~")
    .filter(Boolean)
    .map((e) => {
      const [name, dataType, udt] = e.split(":");
      const [table, column] = name.split(".");
      return { table, column, dataType, udt };
    });
const created = parse(r.res.all_cols);
const added = (r.res.added_to_prefs ?? "").split("~").filter(Boolean).map((e) => {
  const [name, dataType, nullable, dflt] = e.split(":");
  const [table, column] = name.split(".");
  return { table, column, dataType, nullable, dflt };
});
const inScope = [...created.map((c) => `${c.table}.${c.column}`), ...added.map((c) => `${c.table}.${c.column}`)];

describe("test (a): no email-like column except two closed reviewed lists", () => {
  it("the replay applies and the catalogue was read (seven created tables, seven added columns)", () => {
    expect(r.ok, r.stderr).toBe(true);
    expect(new Set(created.map((c) => c.table)).size).toBe(7);
    expect(added.map((c) => c.column)).toEqual(["email_announcements", "email_promotions", "push_application_viewed", "push_enabled", "push_match_alert", "push_new_applicant", "push_promotions"]);
  });
  it("control: the name rule matches an address-like name and does not match an ordinary one", () => {
    for (const bad of ["recipient_email", "contact_email", "mail_address", "to_address", "Email", "recipientId"]) expect(NAME_RULE.test(bad), bad).toBe(true);
    for (const ok of ["user_id", "push_enabled", "channels", "kind"]) expect(NAME_RULE.test(ok), ok).toBe(false);
  });
  it("every column that matches the name rule is on list 1 or list 2; a stranger is reported as table.column", () => {
    const flagged = inScope.filter((n) => NAME_RULE.test(n.split(".")[1]));
    const strangers = flagged.filter((n) => ![...LIST_1, ...LIST_2].includes(n));
    expect(strangers, `email-like column(s) not on the reviewed lists: ${strangers.join(", ")}`).toEqual([]);
    expect(flagged.sort()).toEqual([...LIST_1, ...LIST_2].sort());
  });
  it("every list-2 column is a boolean or a closed-value column, never free text", () => {
    const col = (n: string) => created.find((c) => `${c.table}.${c.column}` === n);
    expect(col("admin_message_recipients.to_email")?.dataType).toBe("boolean");
    const checks = r.res.checks ?? "";
    const emailOutcome = checks.split(" ## ").find((c) => c.startsWith("admin_message_recipients|") && c.includes("email_outcome"));
    expect(emailOutcome, "email_outcome must be guarded by a CHECK that lists its values").toBeTruthy();
    for (const label of ["sent", "failed", "skipped_opted_out", "skipped_quiet_hours", "skipped_cap", "skipped_deleted", "skipped_inactive"]) expect(emailOutcome).toContain(`'${label}'::text`);
  });
  it("email_promotions is boolean NOT NULL default false and email_announcements is boolean NOT NULL default true", () => {
    const get = (c: string) => added.find((a) => a.column === c)!;
    expect(get("email_promotions")).toMatchObject({ dataType: "boolean", nullable: "NO", dflt: "false" });
    expect(get("email_announcements")).toMatchObject({ dataType: "boolean", nullable: "NO", dflt: "true" });
  });
  it("the five operator columns of list 1 are text (addresses kept on purpose), nothing else is", () => {
    for (const n of LIST_1) expect(created.find((c) => `${c.table}.${c.column}` === n)?.dataType, n).toBe("text");
  });
});

describe("test (c): the ledger, the recipients table and the devices table gain no email-like column", () => {
  it("their columns are listed here and only the two reviewed recipient columns match the name rule", () => {
    const of = (t: string) => created.filter((c) => c.table === t).map((c) => c.column);
    expect(of("notification_deliveries")).toEqual(["channel", "claimed_at", "device_id", "id", "kind", "released_at", "sent_at", "subject_id", "user_id"]);
    expect(of("push_subscriptions")).toEqual(["auth", "created_at", "endpoint", "id", "last_seen_at", "p256dh", "revoke_reason", "revoked_at", "timezone", "ua_short", "user_id"]);
    expect(of("admin_message_recipients")).toEqual(["email_outcome", "id", "message_id", "push_outcome", "to_email", "to_inapp", "to_push", "user_id"]);
    const flagged = ["notification_deliveries", "push_subscriptions", "admin_message_recipients"].flatMap((t) => of(t).filter((c) => NAME_RULE.test(c)).map((c) => `${t}.${c}`));
    expect(flagged.sort()).toEqual(["admin_message_recipients.email_outcome", "admin_message_recipients.to_email"]);
  });
});

describe("test (d): the free-text inventory", () => {
  const FREE = (c: Col) => c.dataType === "text" || c.dataType === "character varying" || c.dataType === "jsonb" || (c.dataType === "ARRAY" && /^_(text|varchar|jsonb)$/.test(c.udt));
  it("every text, varchar or jsonb column (and array of them) on the created tables and among the added columns is on list D; a stranger is reported as table.column", () => {
    const free = created.filter(FREE).map((c) => `${c.table}.${c.column}`);
    const addedFree = added.filter((a) => a.dataType === "text" || a.dataType === "jsonb" || a.dataType === "character varying").map((a) => `${a.table}.${a.column}`);
    const strangers = [...free, ...addedFree].filter((n) => !(n in LIST_D));
    expect(strangers, `free-text column(s) not on the reviewed list D: ${strangers.join(", ")}`).toEqual([]);
    expect(addedFree).toEqual([]);
  });
  it("list D has no entry for a column that does not exist (the list is not padded)", () => {
    for (const n of Object.keys(LIST_D)) expect(inScope, n).toContain(n);
  });
  it("any column named like a failure, error, reason, outcome or status is guarded by a CHECK that lists closed codes", () => {
    const named = created.filter((c) => /(failure|error|reason|outcome|status)/i.test(c.column));
    expect(named.map((c) => `${c.table}.${c.column}`).sort()).toEqual(["admin_message_recipients.email_outcome", "admin_message_recipients.push_outcome", "admin_messages.status", "push_subscriptions.revoke_reason"]);
    for (const c of named) {
      const def = (r.res.checks ?? "").split(" ## ").find((d) => d.startsWith(`${c.table}|`) && d.includes(c.column) && d.includes("ARRAY["));
      expect(def, `${c.table}.${c.column} must be guarded by a CHECK listing closed codes`).toBeTruthy();
    }
  });
  it("the settings change log: key is a foreign key to the settings table, old_value and new_value are integers", () => {
    expect(r.res.key_fk).toBe("notification_settings");
    for (const n of ["notification_setting_changes.old_value", "notification_setting_changes.new_value"]) expect(created.find((c) => `${c.table}.${c.column}` === n)?.dataType, n).toBe("integer");
  });
});
