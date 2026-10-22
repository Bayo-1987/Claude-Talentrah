/**
 * THE NOTIFICATIONS CONTRACT (N2). Hand-written, derived from the text of the
 * migration author's prompt (sections 2.1 to 2.9) and its email-pins addendum,
 * NOT from any generated database type.
 *
 * WHY IT DOES NOT IMPORT THE GENERATED SUPABASE TYPES. The tables and functions
 * this file describes do not exist in the generated types until the database PR
 * regenerates them, so a contract that imported them would not compile. Every
 * type here is plain TypeScript; the database PR adds a type-level conformance
 * test that proves these row types are assignable to the regenerated ones, so
 * the SQL and this file cannot drift apart unnoticed.
 *
 * WHAT IS NOT IN THIS FILE: the database object names. Table names and function
 * names are defined in ONE place, `contract-db.ts`, and nowhere else in `src/`
 * or `tests/` (a boundary test fails on any other file that spells one, this
 * file's comments included). Everything here is keyed by a stable camelCase key
 * instead; `contract-db.ts` maps each key to its database name and a type-level
 * check makes a key that exists on one side and not the other a compile error.
 *
 * WHO MAY CHANGE IT: only the notifications database author, in a contract
 * change the CTO has approved. Builders read it and stop and report if they need
 * a change.
 *
 * CONTRACT NOTES (Reviewer decisions of 22 Oct 2026; they win over the prompt)
 *
 *  1. The prune function is NOT in this contract. The database PR adds it (one
 *     integer argument, default 30 days, returns the number of rows deleted,
 *     service role only) together with its accessor and fake. That is the one
 *     recorded exception to "only a contract-change PR changes the contract".
 *  2. The claim function returns ONE row, `{ id, refused }`, and EXACTLY ONE of
 *     the two is non-null. Refusals are checked in this fixed order and the
 *     first one that applies is reported:
 *       1. device_unavailable  push only: the device is missing, someone
 *                              else's, or revoked
 *       2. quiet_hours         push only: 22:00 to 07:00 in the device's zone
 *       3. budget_cap          push only: the person's distinct-event count for
 *                              this kind's budget is at its cap
 *       4. cap_24h             admin email only: the rolling 24 hour cap
 *       5. ceiling_month       admin email only: the UTC calendar month ceiling
 *       6. already_claimed     every channel: the unreleased unique key is taken
 *     These six codes are the CLOSED list the database PR's claim function
 *     must produce (and no other): device_unavailable, quiet_hours,
 *     budget_cap, cap_24h, ceiling_month, already_claimed.
 *     Each adjacent pair that can apply together (1-2, 2-3, 3-6 for push;
 *     4-5, 5-6 for admin email) is pinned by one test.
 *  3. Push budget as built: the event being claimed is not counted against
 *     itself, so a second device for an already-counted event is allowed at
 *     the cap and a new distinct event at the cap is refused.
 *  4. Releasing an unknown id raises (P0001, hint unknown_id).
 *  6. The register function refuses over-long values and never truncates:
 *     endpoint 2048, p256dh and auth 256, timezone 64, ua_short 40. The
 *     database PR must carry matching CHECK constraints; the conformance test
 *     asserts them.
 *  7. One devices row per endpoint. Registering an endpoint that exists updates
 *     that row in place to the new person (owner, keys, last_seen_at, and
 *     revoked_at cleared). The previous owner no longer sees it and cannot
 *     delete it. There is no "rebound" revoke reason.
 *  8. `last_seen_at` is NOT NULL, default now().
 * 10. The addendum spells a 'rejected' audit event. NOTHING writes it in the
 *     database PR's scope: no function and no status exists for it.
 * 12. When the flags stop a start, the start function returns null AND the
 *     flag_stopped event is persisted. It does not raise: a raise would roll
 *     the event back.
 * 13. The messages table carries integer NOT NULL DEFAULT 0 count columns
 *     (sent, failed, skipped). The number of recipients is `audience_count`.
 *     Event rows carry no counts. No column name contains email, address or
 *     recipient except the seven on the email-pins addendum's closed lists.
 * 15. The database raises with an errcode (22023, 42501 or P0001) and puts the
 *     reason in the exception HINT; the accessor reads the HINT. The
 *     conformance test reads it through the Data API.
 * 16. The devices owner column references the user table ON DELETE CASCADE.
 *     The fakes model the cascade only.
 * 17. The push payload and the route shapes are PROVISIONAL and change only
 *     through a contract-change PR.
 *
 * WHAT THE BOUNDARY TEST SCANS. Every file under `src/` and `tests/` outside the
 * allowlist, as whole words: comments and test titles are scanned too, so none
 * of them may spell a table or function name. An underscore is a word character,
 * so a longer identifier that merely contains a name is not a hit.
 *
 * THE TYPE-ONLY CYCLE. `contract-db.ts` imports types from this file and this
 * file imports two name-union types from `contract-db.ts`. Both imports are
 * `import type`, so both are erased at compile time and there is no runtime
 * cycle.
 */
import type {
  CLAIM_REFUSALS,
  NOTIFICATION_ERROR_CODES,
  NOTIFICATION_REFUSAL_REASONS,
  NotificationRpcName,
  NotificationTableName,
} from "./contract-db";

/* ------------------------------------------------------------------ */
/* Closed lists. Each is the single source for its union type.        */
/* ------------------------------------------------------------------ */

/** The four event kinds a ledger row can carry. */
export const NOTIFICATION_KINDS = ["new_applicant", "application_viewed", "match_alert", "admin_message"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = ["inapp", "push", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * The only reasons a push claim may be released. An UNKNOWN outcome (the
 * process died mid-send) is never a reason: that claim stays open.
 */
export const PUSH_RELEASE_REASONS = ["gone", "rejected_413", "retries_exhausted", "our_key", "pre_send_failure"] as const;
export type PushReleaseReason = (typeof PUSH_RELEASE_REASONS)[number];

export const PUSH_REVOKE_REASONS = ["gone", "user", "kill", "deleted", "bad_key"] as const;
export type PushRevokeReason = (typeof PUSH_REVOKE_REASONS)[number];

export const ADMIN_MESSAGE_KINDS = ["service_announcement", "promotion"] as const;
export type AdminMessageKind = (typeof ADMIN_MESSAGE_KINDS)[number];

/**
 * 'draft', 'prepared', 'approved', 'sending', 'sent' and the two paused
 * statuses are spelled in the prompt. 'submitted' and 'cancelled' are implied
 * by the submit and cancel functions but never spelled (see the ambiguity
 * table in the N2 report).
 */
export const ADMIN_MESSAGE_STATUSES = [
  "draft",
  "prepared",
  "submitted",
  "approved",
  "sending",
  "sent",
  "cancelled",
  "paused_email_cap",
  "paused_email_ceiling",
] as const;
export type AdminMessageStatus = (typeof ADMIN_MESSAGE_STATUSES)[number];

export const ADMIN_SEGMENT_KEYS = [
  "everyone",
  "seekers",
  "employers",
  "verified_employers",
  "inactive_seekers",
  "signed_up_since",
  "country",
  "self_test",
] as const;
export type AdminSegmentKey = (typeof ADMIN_SEGMENT_KEYS)[number];

/** The closed outcome set for a recipient's push or email outcome. Empty (null) means queued. */
export const ADMIN_RECIPIENT_OUTCOMES = [
  "sent",
  "failed",
  "skipped_opted_out",
  "skipped_quiet_hours",
  "skipped_cap",
  "skipped_deleted",
  "skipped_inactive",
] as const;
export type AdminRecipientOutcome = (typeof ADMIN_RECIPIENT_OUTCOMES)[number];

/** The event kinds the email-pins addendum lists for the audit table. */
export const ADMIN_MESSAGE_EVENT_KINDS = [
  "created",
  "prepared",
  "test_sent",
  "submitted",
  "approved",
  "rejected",
  "send_started",
  "send_finished",
  "cancelled",
  "flag_stopped",
  "claim_resolved",
  "resumed",
] as const;
export type AdminMessageEventKind = (typeof ADMIN_MESSAGE_EVENT_KINDS)[number];

export const STALE_CLAIM_RESOLUTIONS = ["mark_sent", "release_for_retry"] as const;
export type StaleClaimResolution = (typeof STALE_CLAIM_RESOLUTIONS)[number];

export const UNSUBSCRIBE_STREAMS = ["announcements", "promotions"] as const;
export type UnsubscribeStream = (typeof UNSUBSCRIBE_STREAMS)[number];

/**
 * Why a claim returned no id, in the order the checks run (see contract note 2).
 * The list is defined in `contract-db.ts` because the accessor validates against
 * it at run time.
 */
export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];

/** The two admin-email limits. The sender pauses with a different status for each. */
export const EMAIL_LIMIT_REFUSALS = ["cap_24h", "ceiling_month"] as const;
export type EmailLimitRefusal = (typeof EMAIL_LIMIT_REFUSALS)[number];

/** The two keys the settings table may hold (closed list). */
export const NOTIFICATION_SETTING_KEYS = ["mass_email_cap_24h", "mass_email_ceiling_month"] as const;
export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];

/** Admin permission labels the notification functions check at call time, read as text. */
export const NOTIFICATION_PERMISSIONS = ["user_messaging", "operators"] as const;
export type NotificationPermission = (typeof NOTIFICATION_PERMISSIONS)[number];

/* ------------------------------------------------------------------ */
/* Flags and limits.                                                   */
/* ------------------------------------------------------------------ */

/** Feature flag keys the migration inserts, all disabled. A missing row means off. */
export const NOTIFICATION_FLAGS = {
  master: "notifications_master",
  pushSender: "push_sender",
  adminMessaging: "admin_messaging",
  adminPromotions: "admin_promotions",
  adminEmail: "admin_email",
} as const;
export type NotificationFlagKey = (typeof NOTIFICATION_FLAGS)[keyof typeof NOTIFICATION_FLAGS];

/**
 * Constants the database enforces inside its functions. They are repeated here
 * so the fakes enforce the same numbers; the database is the authority and the
 * database PR's tests prove the two agree.
 */
export const NOTIFICATION_LIMITS = {
  /** Distinct (kind, subject) push events per person per window, user-event budget. */
  userEventPushCap: 3,
  /** Same, admin budget. The two budgets never count each other. */
  adminPushCap: 1,
  claimWindowHours: 24,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  defaultTimezone: "Africa/Lagos",
  maxActiveDevices: 10,
  uaShortMaxLength: 40,
  /** Length caps for register: the prompt says "length caps" without numbers (GUESS). */
  endpointMaxLength: 2048,
  keyMaxLength: 256,
  timezoneMaxLength: 64,
  adminAudienceDefaultMax: 500,
  adminAudienceCeiling: 5000,
  adminPerOperatorPerDay: 5,
  adminOverallPerDay: 10,
  adminEmailInactiveDays: 30,
  retentionDays: 30,
  defaultMassEmailCap24h: 50,
  defaultMassEmailCeilingMonth: 2000,
  settingMax: 10000,
  titleMaxLength: 80,
  bodyMaxLength: 500,
} as const;

/* ------------------------------------------------------------------ */
/* Row types. ISO strings for timestamps, as the API returns them.     */
/* `type` aliases (not interfaces) so they satisfy index-signature      */
/* constraints on client generics.                                     */
/* ------------------------------------------------------------------ */

export type NotificationDeliveryRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  subject_id: string;
  device_id: string | null;
  channel: NotificationChannel;
  claimed_at: string;
  sent_at: string | null;
  released_at: string | null;
};

/** Full row. Service role only: the credential-like columns are never returned to a browser. */
export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  ua_short: string;
  timezone: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  revoke_reason: PushRevokeReason | null;
};

/**
 * The five columns a signed-in person may select from their own rows.
 *
 * DELETE RULE FOR THE DEVICES TABLE (grants addendum G4). A signed-in person has
 * no SELECT on the owner column or the endpoint, so their own-row delete must
 * filter by `id`: a delete filtered by the owner column is refused. The
 * sign-out route runs as the service role and filters by the owner AND the
 * endpoint. `PushDeviceRemoveRequest` (id) and `PushSignOutRequest` (endpoint)
 * below follow that split.
 */
export type PushSubscriptionClientRow = Pick<
  PushSubscriptionRow,
  "id" | "ua_short" | "created_at" | "last_seen_at" | "revoked_at"
>;

/** The columns this release adds to the email preferences row (service role only). */
export type EmailPreferencesNotificationColumns = {
  push_enabled: boolean;
  push_new_applicant: boolean;
  push_application_viewed: boolean;
  push_match_alert: boolean;
  push_promotions: boolean;
  email_promotions: boolean;
  email_announcements: boolean;
};

/** Parameters of the closed segments. Parameter names are a GUESS (see the report). */
export type AdminSegmentParams = {
  days?: 30 | 60 | 90;
  since?: string;
  country?: string;
};

export type AdminMessageRow = {
  id: string;
  kind: AdminMessageKind;
  title: string;
  body: string;
  link_path: string | null;
  channels: NotificationChannel[];
  segment_key: AdminSegmentKey;
  segment_params: AdminSegmentParams;
  consent_line: string | null;
  status: AdminMessageStatus;
  requires_approval: boolean;
  audience_count: number;
  /** Integer counts, NOT NULL DEFAULT 0 (contract note 13). The recipient total is `audience_count`. */
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  kind_confirmed_by_approver: string | null;
  created_by: string | null;
  created_by_email: string;
  approved_by: string | null;
  approved_by_email: string | null;
  sent_started_at: string | null;
  created_at: string;
};

export type AdminMessageRecipientRow = {
  id: string;
  message_id: string;
  user_id: string;
  to_inapp: boolean;
  to_push: boolean;
  /** A per-channel boolean flag, not an address. */
  to_email: boolean;
  push_outcome: AdminRecipientOutcome | null;
  /** A closed-list outcome, not an address. */
  email_outcome: AdminRecipientOutcome | null;
};

/**
 * The audit event detail. Its keys are a CLOSED list fixed by the addendum:
 * `kind_confirmed` and `resolution`. Counts live in integer columns, never here.
 */
export type AdminMessageEventDetail = {
  kind_confirmed?: AdminMessageKind;
  resolution?: StaleClaimResolution;
};

export type AdminMessageEventRow = {
  id: string;
  message_id: string | null;
  event: AdminMessageEventKind;
  detail: AdminMessageEventDetail;
  actor_admin_id: string | null;
  actor_email: string | null;
  at: string;
};

export type NotificationSettingRow = {
  key: NotificationSettingKey;
  int_value: number;
  updated_by_email: string | null;
  updated_at: string;
};

export type NotificationSettingChangeRow = {
  id: string;
  key: NotificationSettingKey;
  old_value: number | null;
  new_value: number;
  actor_admin_id: string | null;
  actor_email: string | null;
  at: string;
};

/** Row type per table, keyed by the same camelCase keys `contract-db.ts` maps to table names. */
export type NotificationTableRows = {
  deliveries: NotificationDeliveryRow;
  pushSubscriptions: PushSubscriptionRow;
  adminMessages: AdminMessageRow;
  adminMessageRecipients: AdminMessageRecipientRow;
  adminMessageEvents: AdminMessageEventRow;
  settings: NotificationSettingRow;
  settingChanges: NotificationSettingChangeRow;
};
export type NotificationTableKey = keyof NotificationTableRows;

/* ------------------------------------------------------------------ */
/* Function arguments and results, keyed by camelCase function key.    */
/* Argument property names are the database argument names.            */
/* ------------------------------------------------------------------ */

export type ClaimNotificationArgs = {
  p_user: string;
  p_kind: NotificationKind;
  p_subject: string;
  p_channel: NotificationChannel;
  p_device?: string | null;
  /** An interval literal such as "24 hours". Defaults to 24 hours in the database. */
  p_window?: string;
};
/** One row; exactly one of `id` and `refused` is non-null. */
export type ClaimNotificationResult =
  | { id: string; refused: null }
  | { id: null; refused: ClaimRefusal };

export type ReleaseNotificationArgs = { p_id: string; p_reason: PushReleaseReason };
export type MarkNotificationSentArgs = { p_id: string };

export type StaleClaimsArgs = { p_channel: NotificationChannel; p_older_than: string };
/** Ids and counts only. No address is ever returned. */
export type StaleClaimRow = {
  id: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  claimed_at: string;
};

export type ResolveStaleClaimArgs = { p_id: string; p_actor: string; p_resolution: StaleClaimResolution };
export type UnreadCountArgs = { p_user: string };

/** Caller is identified by the session (`auth.uid()`), so there is no user argument. */
export type RegisterPushSubscriptionArgs = {
  p_endpoint: string;
  p_p256dh: string;
  p_auth: string;
  p_ua: string;
  p_timezone?: string | null;
};

export type EmailUnsubscribeStreamArgs = { p_token: string; p_stream: UnsubscribeStream; p_subscribed?: boolean };
export type EmailUnsubscribeStreamResult = { matched: boolean };

export type ResolveAdminSegmentArgs = { p_key: AdminSegmentKey; p_params: AdminSegmentParams; p_actor: string };
export type PrepareAdminMessageArgs = { p_message: string; p_actor: string; p_max_audience: number };
export type AdminMessageActorArgs = { p_message: string; p_actor: string };
export type ApproveAdminMessageArgs = { p_message: string; p_actor: string; p_kind_confirmed: AdminMessageKind };
export type AdminMessageAuditArgs = { p_actor: string; p_message?: string | null };
export type PauseAdminMessageSendArgs = { p_message: string; p_reason: EmailLimitRefusal };
export type SetNotificationSettingArgs = { p_key: NotificationSettingKey; p_value: number; p_actor: string };
export type AdminEmailEligibleRecipientsArgs = { p_user_ids: string[]; p_stream: UnsubscribeStream };

/**
 * Every function, with the argument and result shapes the accessor module and
 * the fakes both implement. `void` results come back from the database as null.
 */
export interface RpcContract {
  claimNotification: { args: ClaimNotificationArgs; result: ClaimNotificationResult };
  releaseNotification: { args: ReleaseNotificationArgs; result: void };
  markNotificationSent: { args: MarkNotificationSentArgs; result: void };
  staleNotificationClaims: { args: StaleClaimsArgs; result: StaleClaimRow[] };
  resolveStaleClaim: { args: ResolveStaleClaimArgs; result: void };
  unreadNotificationCount: { args: UnreadCountArgs; result: number };
  registerPushSubscription: { args: RegisterPushSubscriptionArgs; result: string };
  emailUnsubscribeStream: { args: EmailUnsubscribeStreamArgs; result: EmailUnsubscribeStreamResult };
  resolveAdminSegment: { args: ResolveAdminSegmentArgs; result: string[] };
  prepareAdminMessage: { args: PrepareAdminMessageArgs; result: number };
  submitAdminMessage: { args: AdminMessageActorArgs; result: void };
  approveAdminMessage: { args: ApproveAdminMessageArgs; result: void };
  cancelAdminMessage: { args: AdminMessageActorArgs; result: void };
  /** The message id when this call started the send; null on a repeat or when the flags stop it. */
  startAdminMessageSend: { args: AdminMessageActorArgs; result: string | null };
  adminMessageAudit: { args: AdminMessageAuditArgs; result: AdminMessageEventRow[] };
  recordAdminMessageTest: { args: AdminMessageActorArgs; result: void };
  setNotificationSetting: { args: SetNotificationSettingArgs; result: void };
  pauseAdminMessageSend: { args: PauseAdminMessageSendArgs; result: void };
  resumeAdminMessageSend: { args: AdminMessageActorArgs; result: void };
  adminEmailEligibleRecipients: { args: AdminEmailEligibleRecipientsArgs; result: string[] };
}
export type RpcKey = keyof RpcContract;

/** Functions a signed-in person calls with their own session. */
export type SessionRpcKey = "registerPushSubscription";
/** Functions only the service role executes. */
export type ServiceRpcKey = Exclude<RpcKey, SessionRpcKey>;

export type RpcFunctions<K extends RpcKey> = {
  [P in K]: (args: RpcContract[P]["args"]) => Promise<RpcContract[P]["result"]>;
};
/** What the fake backend implements for the service role. */
export type ServiceRpcs = RpcFunctions<ServiceRpcKey>;
/** What the fake backend implements for a signed-in caller. */
export type SessionRpcs = RpcFunctions<SessionRpcKey>;

/* ------------------------------------------------------------------ */
/* Errors.                                                             */
/* ------------------------------------------------------------------ */

/**
 * The codes an accessor or a fake raises. The lists themselves are defined in
 * `contract-db.ts` (the accessor module needs them at run time and may import
 * only types from this file); the types are derived here. They come from the SQLSTATE the
 * database returns, never from message text: a database message can echo a
 * credential-like value, and none may reach an error message here.
 *   invalid_parameter  22023 (for example a time zone that is not an IANA name)
 *   permission_denied  42501
 *   refused            any other raised exception; `reason` says why when the hint carries one
 */
export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number];

/**
 * Why a refusal happened. PROPOSAL, not in the prompt: the database raises with
 * the reason as the exception HINT, which the accessor reads. If it is absent
 * the reason is null.
 */
export type NotificationRefusalReason = (typeof NOTIFICATION_REFUSAL_REASONS)[number];

/** What an error says about itself. Never carries a message from the database. */
export type NotificationErrorInfo = {
  code: NotificationErrorCode;
  sqlstate: string | null;
  reason: NotificationRefusalReason | null;
  rpc: NotificationRpcName | null;
  table: NotificationTableName | null;
};

/* ------------------------------------------------------------------ */
/* Push payload and sender.                                            */
/* ------------------------------------------------------------------ */

/**
 * What a lock-screen alert carries. No match score, tier or percentage ever
 * appears in `title` or `body`. Field names are a GUESS (the prompt does not
 * spell the payload).
 */
export type PushPayload = {
  v: 1;
  kind: NotificationKind;
  title: string;
  body: string;
  /** A same-origin path. */
  url: string;
  tag: string;
  /** The unread count the badge should show, or null to leave it alone. */
  badge: number | null;
};

/** What the sender needs to reach one device. Credential-like: never logged. */
export type PushTarget = {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** 'unknown' means the process cannot tell whether the provider accepted it; the claim stays open. */
export type PushSendOutcome = "sent" | PushReleaseReason | "unknown";
export type PushSendResult = { outcome: PushSendOutcome };

export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult>;
}

/* ------------------------------------------------------------------ */
/* API route shapes (paths and bodies are a GUESS taken from the plan). */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_ROUTE_PATHS = {
  inbox: "/api/notifications",
  inboxRead: "/api/notifications/read",
  pushRegister: "/api/push/subscribe",
  pushDevices: "/api/push/devices",
  pushDeviceRemove: "/api/push/devices/remove",
  pushSignOut: "/api/push/sign-out",
} as const;

export type InboxItem = {
  id: string;
  title: string;
  body: string;
  /** A same-origin path, or null. */
  link: string | null;
  created_at: string;
  read_at: string | null;
};
export type InboxListResponse = { items: InboxItem[]; unread: number };
export type InboxReadRequest = { id: string } | { all: true };
export type InboxReadResponse = { unread: number };

export type PushRegisterRequest = { endpoint: string; p256dh: string; auth: string; timezone?: string | null };
export type PushRegisterResponse = { id: string };
export type PushDevicesResponse = { devices: PushSubscriptionClientRow[] };
export type PushDeviceRemoveRequest = { id: string };
export type PushSignOutRequest = { endpoint: string };

/** Every route answers with this shape on failure. */
export type NotificationRouteError = { error: NotificationErrorCode };
