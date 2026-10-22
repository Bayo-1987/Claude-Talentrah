/**
 * THE ONE ACCESSOR MODULE for the notifications tables and functions.
 *
 * This is the only file in `src/` and `tests/` (outside the generated types,
 * the migrations and the two database test folders) that may spell a new table
 * name or a new function name, and the only place that reaches them. Every other
 * file calls the functions exported here. A boundary test fails on any other
 * file that spells a name, comments included.
 *
 * WHY A CAST AT ALL. The generated Supabase types do not know these objects
 * until the database PR regenerates them, so the typed client cannot be used on
 * them yet. `loose` below is the ONE `as unknown as` cast in the notifications
 * code. It targets a structural type built from `contract.ts` (no `any`), so the
 * accessors are still typed end to end. The database PR deletes the cast and
 * switches `loose` to the typed client; no caller changes.
 *
 * TYPE-ONLY IMPORTS FROM THE CONTRACT. This file takes every type from
 * `contract.ts` with `import type`, so there is no runtime import cycle even
 * though `contract.ts` imports two name types back from here. The two closed
 * lists the accessors need at run time (error codes and refusal reasons) are
 * therefore defined HERE and `contract.ts` derives its types from them.
 *
 * ERRORS NEVER CARRY DATABASE TEXT. A database message can echo a value (a
 * unique violation prints the offending key, and a key here can be a push
 * endpoint). The accessors build their own message from the function key and
 * the SQLSTATE and drop the database's text entirely.
 *
 * Callers use a service-role client unless a function says otherwise. The
 * session-bound function (`registerPushSubscription`) takes the signed-in
 * person's own client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type {
  AdminEmailEligibleRecipientsArgs,
  AdminMessageActorArgs,
  AdminMessageAuditArgs,
  AdminMessageEventRow,
  ApproveAdminMessageArgs,
  ClaimNotificationArgs,
  ClaimNotificationResult,
  ClaimRefusal,
  EmailUnsubscribeStreamArgs,
  EmailUnsubscribeStreamResult,
  MarkNotificationSentArgs,
  NotificationErrorInfo,
  NotificationTableKey,
  NotificationTableRows,
  PauseAdminMessageSendArgs,
  PrepareAdminMessageArgs,
  PruneNotificationDeliveriesArgs,
  RegisterPushSubscriptionArgs,
  ReleaseNotificationArgs,
  ResolveAdminSegmentArgs,
  ResolveStaleClaimArgs,
  RpcContract,
  RpcKey,
  SetNotificationSettingArgs,
  StaleClaimRow,
  StaleClaimsArgs,
  UnreadCountArgs,
} from "./contract";

/* ------------------------------------------------------------------ */
/* The names. Defined here and nowhere else.                           */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_TABLES = {
  deliveries: "notification_deliveries",
  pushSubscriptions: "push_subscriptions",
  adminMessages: "admin_messages",
  adminMessageRecipients: "admin_message_recipients",
  adminMessageEvents: "admin_message_events",
  settings: "notification_settings",
  settingChanges: "notification_setting_changes",
} as const satisfies Record<NotificationTableKey, string>;
export type NotificationTableName = (typeof NOTIFICATION_TABLES)[NotificationTableKey];

export const NOTIFICATION_RPCS = {
  claimNotification: "claim_notification",
  releaseNotification: "release_notification",
  markNotificationSent: "mark_notification_sent",
  staleNotificationClaims: "stale_notification_claims",
  resolveStaleClaim: "resolve_stale_claim",
  unreadNotificationCount: "unread_notification_count",
  pruneNotificationDeliveries: "prune_notification_deliveries",
  registerPushSubscription: "register_push_subscription",
  emailUnsubscribeStream: "email_unsubscribe_stream",
  resolveAdminSegment: "resolve_admin_segment",
  prepareAdminMessage: "prepare_admin_message",
  submitAdminMessage: "submit_admin_message",
  approveAdminMessage: "approve_admin_message",
  cancelAdminMessage: "cancel_admin_message",
  startAdminMessageSend: "start_admin_message_send",
  adminMessageAudit: "admin_message_audit",
  recordAdminMessageTest: "record_admin_message_test",
  setNotificationSetting: "set_notification_setting",
  pauseAdminMessageSend: "pause_admin_message_send",
  resumeAdminMessageSend: "resume_admin_message_send",
  adminEmailEligibleRecipients: "admin_email_eligible_recipients",
} as const satisfies Record<RpcKey, string>;
export type NotificationRpcName = (typeof NOTIFICATION_RPCS)[RpcKey];

/* ------------------------------------------------------------------ */
/* Error vocabulary and the error class.                               */
/* ------------------------------------------------------------------ */

/** Why a claim returned no id, in check order (contract note 2). */
export const CLAIM_REFUSALS = [
  "device_unavailable",
  "quiet_hours",
  "budget_cap",
  "cap_24h",
  "ceiling_month",
  "already_claimed",
] as const;

export const NOTIFICATION_ERROR_CODES = ["invalid_parameter", "permission_denied", "refused", "unknown"] as const;

export const NOTIFICATION_REFUSAL_REASONS = [
  "email_release_refused",
  "invalid_release_reason",
  "flag_off",
  "consent_required",
  "audience_over_limit",
  "operator_daily_limit",
  "overall_daily_limit",
  "self_approval",
  "kind_not_confirmed",
  "invalid_state",
  "not_found",
  "unknown_id",
  "not_https",
  "value_too_long",
  "device_limit",
  "setting_key_unknown",
  "setting_value_out_of_range",
] as const;

type ErrorCode = NotificationErrorInfo["code"];
type RefusalReason = NonNullable<NotificationErrorInfo["reason"]>;

const SQLSTATE_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  "22023": "invalid_parameter",
  "42501": "permission_denied",
  P0001: "refused",
};

function isRefusalReason(value: unknown): value is RefusalReason {
  return typeof value === "string" && (NOTIFICATION_REFUSAL_REASONS as readonly string[]).includes(value);
}

/** Thrown by the accessors and by the fakes. Its message never contains database text. */
export class NotificationDbError extends Error {
  readonly info: NotificationErrorInfo;
  constructor(info: NotificationErrorInfo) {
    const where = info.rpc ?? info.table ?? "notifications";
    const state = info.sqlstate ? ` ${info.sqlstate}` : "";
    const why = info.reason ? ` (${info.reason})` : "";
    super(`notifications: ${where} failed: ${info.code}${state}${why}`);
    this.name = "NotificationDbError";
    this.info = info;
  }
}

type RawDbError = { code?: string | null; hint?: string | null };

/**
 * Turns a database error into the contract's error. Reads the SQLSTATE and the
 * hint only; the database's own message and details are discarded on purpose.
 */
export function notificationErrorFrom(
  error: RawDbError,
  source: { rpc?: RpcKey; table?: NotificationTableKey },
): NotificationDbError {
  const sqlstate = typeof error.code === "string" && error.code.length > 0 ? error.code : null;
  const code: ErrorCode = (sqlstate && SQLSTATE_TO_CODE[sqlstate]) || "unknown";
  return new NotificationDbError({
    code,
    sqlstate,
    reason: isRefusalReason(error.hint) ? error.hint : null,
    rpc: source.rpc ? NOTIFICATION_RPCS[source.rpc] : null,
    table: source.table ? NOTIFICATION_TABLES[source.table] : null,
  });
}

/* ------------------------------------------------------------------ */
/* The loose client. The ONE cast.                                     */
/* ------------------------------------------------------------------ */

/** Whatever client the caller holds: service role, or a signed-in session. */
export type NotificationClient = SupabaseClient<Database>;

type TableByName = {
  [K in NotificationTableKey as (typeof NOTIFICATION_TABLES)[K]]: NotificationTableRows[K];
};
type LooseTables = {
  [N in keyof TableByName]: {
    Row: TableByName[N];
    Insert: Partial<TableByName[N]>;
    Update: Partial<TableByName[N]>;
    Relationships: [];
  };
};
type FunctionByName = { [K in RpcKey as (typeof NOTIFICATION_RPCS)[K]]: RpcContract[K] };
type LooseFunctions = {
  [N in keyof FunctionByName]: { Args: FunctionByName[N]["args"]; Returns: FunctionByName[N]["result"] };
};
/** A structural stand-in for the generated schema. No `any`. */
type LooseDb = {
  public: { Tables: LooseTables; Views: Record<string, never>; Functions: LooseFunctions };
};
type Loose = SupabaseClient<LooseDb>;

function loose(client: NotificationClient): Loose {
  return client as unknown as Loose;
}

/* ------------------------------------------------------------------ */
/* One accessor per table.                                             */
/* ------------------------------------------------------------------ */

export function deliveriesTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.deliveries);
}
export function pushSubscriptionsTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.pushSubscriptions);
}
export function adminMessagesTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.adminMessages);
}
export function adminMessageRecipientsTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.adminMessageRecipients);
}
export function adminMessageEventsTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.adminMessageEvents);
}
export function notificationSettingsTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.settings);
}
export function notificationSettingChangesTable(client: NotificationClient) {
  return loose(client).from(NOTIFICATION_TABLES.settingChanges);
}

/* ------------------------------------------------------------------ */
/* Result normalisation. A function that "returns nothing" reaches us   */
/* as null, an empty array or a one-row array depending on how it is   */
/* declared, so each accessor accepts all of them.                      */
/* ------------------------------------------------------------------ */

function unwrap(
  result: { data: unknown; error: RawDbError | null },
  rpc: RpcKey,
): unknown {
  if (result.error) throw notificationErrorFrom(result.error, { rpc });
  return result.data;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function asClaimRefusal(value: unknown): ClaimRefusal | null {
  return typeof value === "string" && (CLAIM_REFUSALS as readonly string[]).includes(value) ? (value as ClaimRefusal) : null;
}

function asIdList(data: unknown, field: string): string[] {
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data) {
    if (typeof entry === "string") ids.push(entry);
    else if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>)[field] === "string") {
      ids.push((entry as Record<string, string>)[field]);
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* One accessor per function.                                          */
/* ------------------------------------------------------------------ */

export async function claimNotification(
  client: NotificationClient,
  args: ClaimNotificationArgs,
): Promise<ClaimNotificationResult> {
  const row = firstRow(unwrap(await loose(client).rpc(NOTIFICATION_RPCS.claimNotification, args), "claimNotification"));
  if (row && typeof row.id === "string" && row.refused == null) return { id: row.id, refused: null };
  const refused = row && row.id == null ? asClaimRefusal(row.refused) : null;
  if (refused) return { id: null, refused };
  // Not exactly one non-null value: the database broke the contract. Fail loudly.
  throw notificationErrorFrom({ code: null }, { rpc: "claimNotification" });
}

export async function releaseNotification(client: NotificationClient, args: ReleaseNotificationArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.releaseNotification, args), "releaseNotification");
}

export async function markNotificationSent(client: NotificationClient, args: MarkNotificationSentArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.markNotificationSent, args), "markNotificationSent");
}

export async function staleNotificationClaims(
  client: NotificationClient,
  args: StaleClaimsArgs,
): Promise<StaleClaimRow[]> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.staleNotificationClaims, args), "staleNotificationClaims");
  return Array.isArray(data) ? (data as StaleClaimRow[]) : [];
}

export async function resolveStaleClaim(client: NotificationClient, args: ResolveStaleClaimArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.resolveStaleClaim, args), "resolveStaleClaim");
}

export async function unreadNotificationCount(client: NotificationClient, args: UnreadCountArgs): Promise<number> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.unreadNotificationCount, args), "unreadNotificationCount");
  return typeof data === "number" ? data : Number(data ?? 0);
}

/** Deletes finished, non-email claims older than the limit (default 30 days) and returns how many it deleted. */
export async function pruneNotificationDeliveries(
  client: NotificationClient,
  args: PruneNotificationDeliveriesArgs = {},
): Promise<number> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.pruneNotificationDeliveries, args), "pruneNotificationDeliveries");
  return typeof data === "number" ? data : Number(data ?? 0);
}

/** Takes the signed-in person's own client. Returns the device id. */
export async function registerPushSubscription(
  client: NotificationClient,
  args: RegisterPushSubscriptionArgs,
): Promise<string> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.registerPushSubscription, args), "registerPushSubscription");
  const row = firstRow(data);
  const id = typeof data === "string" ? data : row && typeof row.id === "string" ? row.id : null;
  if (!id) throw notificationErrorFrom({ code: null }, { rpc: "registerPushSubscription" });
  return id;
}

export async function emailUnsubscribeStream(
  client: NotificationClient,
  args: EmailUnsubscribeStreamArgs,
): Promise<EmailUnsubscribeStreamResult> {
  const row = firstRow(unwrap(await loose(client).rpc(NOTIFICATION_RPCS.emailUnsubscribeStream, args), "emailUnsubscribeStream"));
  return { matched: row?.matched === true };
}

export async function resolveAdminSegment(client: NotificationClient, args: ResolveAdminSegmentArgs): Promise<string[]> {
  return asIdList(unwrap(await loose(client).rpc(NOTIFICATION_RPCS.resolveAdminSegment, args), "resolveAdminSegment"), "user_id");
}

export async function prepareAdminMessage(client: NotificationClient, args: PrepareAdminMessageArgs): Promise<number> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.prepareAdminMessage, args), "prepareAdminMessage");
  return typeof data === "number" ? data : Number(data ?? 0);
}

export async function submitAdminMessage(client: NotificationClient, args: AdminMessageActorArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.submitAdminMessage, args), "submitAdminMessage");
}

export async function approveAdminMessage(client: NotificationClient, args: ApproveAdminMessageArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.approveAdminMessage, args), "approveAdminMessage");
}

export async function cancelAdminMessage(client: NotificationClient, args: AdminMessageActorArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.cancelAdminMessage, args), "cancelAdminMessage");
}

/** The message id when this call started the send; null for a repeat. */
export async function startAdminMessageSend(
  client: NotificationClient,
  args: AdminMessageActorArgs,
): Promise<string | null> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.startAdminMessageSend, args), "startAdminMessageSend");
  if (typeof data === "string") return data;
  const row = firstRow(data);
  return row && typeof row.id === "string" ? row.id : null;
}

export async function adminMessageAudit(
  client: NotificationClient,
  args: AdminMessageAuditArgs,
): Promise<AdminMessageEventRow[]> {
  const data = unwrap(await loose(client).rpc(NOTIFICATION_RPCS.adminMessageAudit, args), "adminMessageAudit");
  return Array.isArray(data) ? (data as AdminMessageEventRow[]) : [];
}

export async function recordAdminMessageTest(client: NotificationClient, args: AdminMessageActorArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.recordAdminMessageTest, args), "recordAdminMessageTest");
}

export async function setNotificationSetting(client: NotificationClient, args: SetNotificationSettingArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.setNotificationSetting, args), "setNotificationSetting");
}

export async function pauseAdminMessageSend(client: NotificationClient, args: PauseAdminMessageSendArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.pauseAdminMessageSend, args), "pauseAdminMessageSend");
}

export async function resumeAdminMessageSend(client: NotificationClient, args: AdminMessageActorArgs): Promise<void> {
  unwrap(await loose(client).rpc(NOTIFICATION_RPCS.resumeAdminMessageSend, args), "resumeAdminMessageSend");
}

export async function adminEmailEligibleRecipients(
  client: NotificationClient,
  args: AdminEmailEligibleRecipientsArgs,
): Promise<string[]> {
  return asIdList(
    unwrap(await loose(client).rpc(NOTIFICATION_RPCS.adminEmailEligibleRecipients, args), "adminEmailEligibleRecipients"),
    "user_id",
  );
}
