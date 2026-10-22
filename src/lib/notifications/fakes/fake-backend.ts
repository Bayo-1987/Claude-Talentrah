/**
 * In-memory fake of every notifications function, for builders who work before
 * the database exists. It implements the contract's `ServiceRpcs` and, through
 * `forCaller`, the session-bound `SessionRpcs`, and it enforces the same rules
 * the database is specified to enforce (budgets, quiet hours, at-most-once
 * email, permissions, flags). The database is the authority; where the prompt
 * did not spell a behaviour the choice made here is listed in the N2 report's
 * ambiguity table.
 *
 * The clock is injected so quiet hours, the rolling windows and the UTC month
 * can be tested on chosen instants. Database names never appear in this file:
 * the one dispatch helper reads them from the accessor module's constants.
 */
import {
  ADMIN_SEGMENT_KEYS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FLAGS,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIMITS,
  NOTIFICATION_SETTING_KEYS,
  PUSH_RELEASE_REASONS,
  STALE_CLAIM_MIN_AGE_MINUTES,
  STALE_CLAIM_RESOLUTIONS,
  type AdminMessageEventDetail,
  type AdminMessageEventKind,
  type AdminMessageEventRow,
  type AdminMessageKind,
  type AdminMessageRecipientRow,
  type AdminMessageRow,
  type AdminSegmentKey,
  type AdminSegmentParams,
  type ClaimNotificationArgs,
  type ClaimNotificationResult,
  type ClaimRefusal,
  type EmailPreferencesNotificationColumns,
  type NotificationChannel,
  type NotificationDeliveryRow,
  type NotificationFlagKey,
  type NotificationPermission,
  type NotificationSettingChangeRow,
  type NotificationSettingKey,
  type NotificationSettingRow,
  type PushRevokeReason,
  type PushSubscriptionClientRow,
  type PushSubscriptionRow,
  type RpcContract,
  type RpcKey,
  type ServiceRpcs,
  type SessionRpcs,
  type UnsubscribeStream,
} from "../contract";
import { hourInZone, isKnownTimeZone } from "@/lib/format/datetime";
import {
  NOTIFICATION_RPCS,
  NOTIFICATION_TABLES,
  NotificationDbError,
  type NotificationRpcName,
} from "../contract-db";

type Refusal = NonNullable<NotificationDbError["info"]["reason"]>;

/** A person as the fake sees them: the profile fields the segments and eligibility read. */
export type FakePerson = {
  id: string;
  role: "seeker" | "employer";
  verifiedEmployer: boolean;
  country: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  deletionRequested: boolean;
  isQa: boolean;
  /** False when the profile email is blank. */
  emailPresent: boolean;
  /** False when the auth email is not confirmed. */
  emailConfirmed: boolean;
  unsubscribeToken: string | null;
  prefs: EmailPreferencesNotificationColumns;
};

type FakeAdmin = { id: string; email: string; permissions: Set<NotificationPermission> };
type InboxEntry = { id: string; user_id: string; read_at: string | null };

const DEFAULT_PREFS: EmailPreferencesNotificationColumns = {
  push_enabled: false,
  push_new_applicant: false,
  push_application_viewed: false,
  push_match_alert: false,
  push_promotions: false,
  email_promotions: false,
  email_announcements: true,
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const UUID_PREFIX = "00000000-0000-4000-8000-";

/** Parses an interval literal such as "24 hours". Anything else is an invalid parameter. */
function parseInterval(text: string | undefined, fallbackMs: number, rpc: RpcKey): number {
  if (text === undefined) return fallbackMs;
  const match = /^\s*(\d+)\s*(second|minute|hour|day)s?\s*$/i.exec(text);
  if (!match) throw fail("invalid_parameter", "22023", null, rpc);
  const unit = { second: 1000, minute: 60_000, hour: HOUR_MS, day: DAY_MS }[match[2].toLowerCase() as "second"];
  return Number(match[1]) * unit;
}

function fail(
  code: "invalid_parameter" | "permission_denied" | "refused",
  sqlstate: string,
  reason: Refusal | null,
  rpc: RpcKey,
): NotificationDbError {
  return new NotificationDbError({ code, sqlstate, reason, rpc: NOTIFICATION_RPCS[rpc], table: null });
}
const refuse = (rpc: RpcKey, reason: Refusal) => fail("refused", "P0001", reason, rpc);
const denied = (rpc: RpcKey) => fail("permission_denied", "42501", null, rpc);

function isQuietHour(at: Date, timeZone: string): boolean {
  const hour = hourInZone(timeZone, at);
  return hour >= NOTIFICATION_LIMITS.quietHoursStart || hour < NOTIFICATION_LIMITS.quietHoursEnd;
}

/**
 * The rule of the database CHECK on an admin message's link (N1-R29 Q2): a same-origin path. One slash first and not two, at most 200 characters, and no backslash, whitespace or control
 * character. "Whitespace" is exactly what Postgres refuses: every JavaScript whitespace character except U+FEFF, which Postgres accepts. tests/support/n1-link-path-cases.ts holds the cases both sides run.
 */
const LINK_REFUSED = "\\u0000-\\u001f\\u007f-\\u009f \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\\\";
const LINK_PATH = new RegExp(`^/([^/${LINK_REFUSED}][^${LINK_REFUSED}]*)?$`);
export function isSameOriginPath(path: string): boolean {
  return path.length <= 200 && LINK_PATH.test(path);
}

/** The age after which an open e-mail claim may be resolved by hand: the contract's constant (N1-R34); the database holds the same figure as a literal. */
const STALE_CLAIM_AGE_MS = STALE_CLAIM_MIN_AGE_MINUTES * 60 * 1000;

export class FakeNotificationBackend implements ServiceRpcs {
  deliveries: NotificationDeliveryRow[] = [];
  devices: PushSubscriptionRow[] = [];
  messages: AdminMessageRow[] = [];
  recipients: AdminMessageRecipientRow[] = [];
  events: AdminMessageEventRow[] = [];
  settings: NotificationSettingRow[] = [];
  settingChanges: NotificationSettingChangeRow[] = [];
  inbox: InboxEntry[] = [];

  private people = new Map<string, FakePerson>();
  private admins = new Map<string, FakeAdmin>();
  private flags = new Map<string, boolean>();
  private counter = 0;
  private time: number;

  constructor(start: Date = new Date("2026-10-26T12:00:00Z")) {
    this.time = start.getTime();
    // The migration inserts both rows; a missing row would mean 0 (fail closed).
    this.putSetting("mass_email_cap_24h", NOTIFICATION_LIMITS.defaultMassEmailCap24h, null);
    this.putSetting("mass_email_ceiling_month", NOTIFICATION_LIMITS.defaultMassEmailCeilingMonth, null);
  }

  /* ---------------- clock ---------------- */

  now(): Date {
    return new Date(this.time);
  }
  setNow(at: Date): void {
    this.time = at.getTime();
  }
  advance(ms: number): void {
    this.time += ms;
  }

  /* ---------------- seeding ---------------- */

  newId(): string {
    this.counter += 1;
    return `${UUID_PREFIX}${String(this.counter).padStart(12, "0")}`;
  }

  addPerson(input: Partial<Omit<FakePerson, "prefs">> & { id: string; prefs?: Partial<EmailPreferencesNotificationColumns> }): FakePerson {
    const person: FakePerson = {
      role: "seeker",
      verifiedEmployer: false,
      country: null,
      createdAt: this.now().toISOString(),
      lastActiveAt: this.now().toISOString(),
      deletionRequested: false,
      isQa: false,
      emailPresent: true,
      emailConfirmed: true,
      unsubscribeToken: null,
      ...input,
      prefs: { ...DEFAULT_PREFS, ...input.prefs },
    };
    this.people.set(person.id, person);
    return person;
  }
  person(id: string): FakePerson | undefined {
    return this.people.get(id);
  }
  addAdmin(id: string, email: string, permissions: readonly NotificationPermission[]): void {
    this.admins.set(id, { id, email, permissions: new Set(permissions) });
  }
  setFlag(key: NotificationFlagKey, enabled: boolean): void {
    this.flags.set(key, enabled);
  }
  removeFlag(key: NotificationFlagKey): void {
    this.flags.delete(key);
  }
  removeSetting(key: NotificationSettingKey): void {
    this.settings = this.settings.filter((row) => row.key !== key);
  }
  putSetting(key: NotificationSettingKey, value: number, email: string | null): void {
    this.settings = this.settings.filter((row) => row.key !== key);
    this.settings.push({ key, int_value: value, updated_by_email: email, updated_at: this.now().toISOString() });
  }
  addDevice(input: { userId: string; endpoint?: string; timezone?: string; revoked?: boolean }): PushSubscriptionRow {
    const row: PushSubscriptionRow = {
      id: this.newId(),
      user_id: input.userId,
      endpoint: input.endpoint ?? `https://push.example.invalid/${this.counter}`,
      p256dh: "fake-p256dh",
      auth: "fake-auth",
      ua_short: "Chrome on Android",
      timezone: input.timezone ?? NOTIFICATION_LIMITS.defaultTimezone,
      created_at: this.now().toISOString(),
      last_seen_at: this.now().toISOString(),
      revoked_at: input.revoked ? this.now().toISOString() : null,
      revoke_reason: input.revoked ? "user" : null,
    };
    this.devices.push(row);
    return row;
  }
  addInboxItem(userId: string, read = false): InboxEntry {
    const entry = { id: this.newId(), user_id: userId, read_at: read ? this.now().toISOString() : null };
    this.inbox.push(entry);
    return entry;
  }
  /** Creates a draft the way the service role would, by inserting the row. */
  addDraftMessage(input: {
    createdBy: string;
    kind?: AdminMessageKind;
    channels?: readonly NotificationChannel[];
    segmentKey?: AdminSegmentKey;
    segmentParams?: AdminSegmentParams;
    consentLine?: string | null;
    requiresApproval?: boolean;
    title?: string;
    body?: string;
    linkPath?: string | null;
  }): AdminMessageRow {
    const admin = this.admins.get(input.createdBy);
    const linkPath = input.linkPath ?? null;
    if (linkPath !== null && !isSameOriginPath(linkPath)) {
      // The database refuses it with a CHECK violation (SQLSTATE 23514); there is no contract code for that, so it is "unknown", with the table named.
      throw new NotificationDbError({ code: "unknown", sqlstate: "23514", reason: null, rpc: null, table: NOTIFICATION_TABLES.adminMessages });
    }
    const row: AdminMessageRow = {
      id: this.newId(),
      kind: input.kind ?? "service_announcement",
      title: input.title ?? "Title",
      body: input.body ?? "Body",
      link_path: linkPath,
      channels: [...(input.channels ?? ["inapp"])],
      segment_key: input.segmentKey ?? "everyone",
      segment_params: input.segmentParams ?? {},
      consent_line: input.consentLine ?? null,
      status: "draft",
      requires_approval: input.requiresApproval ?? true,
      audience_count: 0,
      sent_count: 0,
      failed_count: 0,
      skipped_count: 0,
      kind_confirmed_by_approver: null,
      created_by: input.createdBy,
      created_by_email: admin?.email ?? "",
      approved_by: null,
      approved_by_email: null,
      sent_started_at: null,
      created_at: this.now().toISOString(),
    };
    this.messages.push(row);
    this.addEvent(row.id, "created", {}, input.createdBy);
    return row;
  }

  /* ---------------- internals ---------------- */

  private flag(key: NotificationFlagKey): boolean {
    return this.flags.get(key) === true; // a missing row is off
  }
  private requirePermission(actor: string, permission: NotificationPermission, rpc: RpcKey): FakeAdmin {
    const admin = this.admins.get(actor);
    if (!admin || !admin.permissions.has(permission)) throw denied(rpc);
    return admin;
  }
  private message(id: string, rpc: RpcKey): AdminMessageRow {
    const row = this.messages.find((m) => m.id === id);
    if (!row) throw refuse(rpc, "not_found");
    return row;
  }
  private addEvent(
    messageId: string | null,
    event: AdminMessageEventKind,
    detail: AdminMessageEventDetail,
    actor: string | null,
  ): void {
    this.events.push({
      id: this.newId(),
      message_id: messageId,
      event,
      detail,
      actor_admin_id: actor,
      actor_email: actor ? (this.admins.get(actor)?.email ?? null) : null,
      at: this.now().toISOString(),
    });
  }
  private settingValue(key: NotificationSettingKey): number {
    return this.settings.find((row) => row.key === key)?.int_value ?? 0; // missing means 0
  }
  private sendFlagsOn(message: AdminMessageRow): boolean {
    if (!this.flag(NOTIFICATION_FLAGS.master) || !this.flag(NOTIFICATION_FLAGS.adminMessaging)) return false;
    if (message.kind === "promotion" && !this.flag(NOTIFICATION_FLAGS.adminPromotions)) return false;
    if (message.channels.includes("email") && !this.flag(NOTIFICATION_FLAGS.adminEmail)) return false;
    return true;
  }
  private eligibleForEmail(person: FakePerson, stream: UnsubscribeStream): boolean {
    const column = stream === "announcements" ? person.prefs.email_announcements : person.prefs.email_promotions;
    return !person.deletionRequested && !person.isQa && column && person.emailPresent && person.emailConfirmed;
  }

  /* ---------------- ledger ---------------- */

  async claimNotification(args: ClaimNotificationArgs): Promise<ClaimNotificationResult> {
    const rpc: RpcKey = "claimNotification";
    if (!NOTIFICATION_KINDS.includes(args.p_kind) || !NOTIFICATION_CHANNELS.includes(args.p_channel)) {
      throw fail("invalid_parameter", "22023", null, rpc);
    }
    const windowMs = parseInterval(args.p_window, DAY_MS, rpc);
    const now = this.now();
    // A device belongs to a push claim only: any other channel ignores it and stores none (N1-R29).
    const device = args.p_channel === "push" ? (args.p_device ?? null) : null;
    const refused = (code: ClaimRefusal): ClaimNotificationResult => ({ id: null, refused: code });
    const open = (row: NotificationDeliveryRow) => row.released_at === null;

    if (args.p_channel === "push") {
      const target = this.devices.find((d) => d.id === device);
      // 1. device_unavailable
      if (!target || target.user_id !== args.p_user || target.revoked_at !== null) return refused("device_unavailable");
      // 2. quiet_hours: the zone is read from the stored device, never from the caller.
      if (isQuietHour(now, target.timezone)) return refused("quiet_hours");
      const adminBudget = args.p_kind === "admin_message";
      const cap = adminBudget ? NOTIFICATION_LIMITS.adminPushCap : NOTIFICATION_LIMITS.userEventPushCap;
      const events = new Set<string>();
      for (const row of this.deliveries) {
        if (row.user_id !== args.p_user || row.channel !== "push" || !open(row)) continue;
        if ((row.kind === "admin_message") !== adminBudget) continue;
        if (now.getTime() - Date.parse(row.claimed_at) >= windowMs) continue;
        // An event already claimed on another device of this person does not count again.
        if (row.kind === args.p_kind && row.subject_id === args.p_subject) continue;
        events.add(`${row.kind}:${row.subject_id}`);
      }
      // 3. budget_cap
      if (events.size >= cap) return refused("budget_cap");
    }

    if (args.p_channel === "email" && args.p_kind === "admin_message") {
      const inWindow = this.deliveries.filter(
        (row) =>
          row.channel === "email" && row.kind === "admin_message" && open(row) && now.getTime() - Date.parse(row.claimed_at) < DAY_MS,
      );
      // 4. cap_24h
      if (inWindow.length >= this.settingValue("mass_email_cap_24h")) return refused("cap_24h");
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const inMonth = this.deliveries.filter(
        (row) => row.channel === "email" && row.kind === "admin_message" && open(row) && Date.parse(row.claimed_at) >= monthStart,
      );
      // 5. ceiling_month
      if (inMonth.length >= this.settingValue("mass_email_ceiling_month")) return refused("ceiling_month");
    }

    const taken = this.deliveries.some(
      (row) =>
        open(row) &&
        row.user_id === args.p_user &&
        row.kind === args.p_kind &&
        row.subject_id === args.p_subject &&
        row.channel === args.p_channel &&
        row.device_id === device,
    );
    // 6. already_claimed
    if (taken) return refused("already_claimed");

    const row: NotificationDeliveryRow = {
      id: this.newId(),
      user_id: args.p_user,
      kind: args.p_kind,
      subject_id: args.p_subject,
      device_id: device,
      channel: args.p_channel,
      claimed_at: now.toISOString(),
      sent_at: null,
      released_at: null,
    };
    this.deliveries.push(row);
    return { id: row.id, refused: null };
  }

  async releaseNotification(args: RpcContract["releaseNotification"]["args"]): Promise<void> {
    const rpc: RpcKey = "releaseNotification";
    const row = this.deliveries.find((d) => d.id === args.p_id);
    if (!row) throw refuse(rpc, "unknown_id");
    // The release function raises P0001 only for an unknown id. Releasing an email claim is
    // not permitted (42501) and a reason outside the closed list is an invalid argument
    // (22023); both keep their reason as the hint.
    if (row.channel === "email") throw fail("permission_denied", "42501", "email_release_refused", rpc);
    if (!PUSH_RELEASE_REASONS.includes(args.p_reason)) throw fail("invalid_parameter", "22023", "invalid_release_reason", rpc);
    if (row.released_at === null) row.released_at = this.now().toISOString();
  }

  async markNotificationSent(args: RpcContract["markNotificationSent"]["args"]): Promise<void> {
    const row = this.deliveries.find((d) => d.id === args.p_id);
    if (!row) throw refuse("markNotificationSent", "not_found");
    if (row.sent_at === null) row.sent_at = this.now().toISOString();
  }

  async staleNotificationClaims(args: RpcContract["staleNotificationClaims"]["args"]) {
    const olderMs = parseInterval(args.p_older_than, 0, "staleNotificationClaims");
    const cutoff = this.now().getTime() - olderMs;
    return this.deliveries
      .filter((d) => d.channel === args.p_channel && d.sent_at === null && d.released_at === null && Date.parse(d.claimed_at) < cutoff)
      .map((d) => ({ id: d.id, kind: d.kind, channel: d.channel, claimed_at: d.claimed_at }));
  }

  async resolveStaleClaim(args: RpcContract["resolveStaleClaim"]["args"]): Promise<void> {
    const rpc: RpcKey = "resolveStaleClaim";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    // An unknown resolution is a caller error (22023), checked after the permission and before the lookup (N1-R29).
    if (!(STALE_CLAIM_RESOLUTIONS as readonly string[]).includes(args.p_resolution)) throw fail("invalid_parameter", "22023", null, rpc);
    const row = this.deliveries.find((d) => d.id === args.p_id);
    if (!row) throw refuse(rpc, "not_found");
    if (row.sent_at !== null || row.released_at !== null) throw refuse(rpc, "invalid_state");
    // Only an e-mail claim open longer than the stale age can be resolved by hand (N1-R31 F6).
    if (row.channel !== "email" || this.now().getTime() - Date.parse(row.claimed_at) < STALE_CLAIM_AGE_MS) throw refuse(rpc, "invalid_state");
    if (args.p_resolution === "mark_sent") row.sent_at = this.now().toISOString();
    else row.released_at = this.now().toISOString();
    this.addEvent(row.kind === "admin_message" ? row.subject_id : null, "claim_resolved", { resolution: args.p_resolution }, args.p_actor);
  }

  /**
   * Retention. Removes finished (sent or released), non-email claims that are strictly older than the limit AND older than the start of the current UTC calendar month, so
   * the monthly email ceiling can never be undercounted. Open claims and email claims are never removed.
   */
  async pruneNotificationDeliveries(args: RpcContract["pruneNotificationDeliveries"]["args"]): Promise<number> {
    const rpc: RpcKey = "pruneNotificationDeliveries";
    const days = args.p_older_than_days === undefined ? 30 : args.p_older_than_days;
    if (days === null || !Number.isInteger(days) || days < 1 || days > 36_500) throw fail("invalid_parameter", "22023", null, rpc);
    const now = this.now();
    const cutoff = now.getTime() - days * DAY_MS;
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const before = this.deliveries.length;
    this.deliveries = this.deliveries.filter((row) => {
      const claimed = Date.parse(row.claimed_at);
      const finished = row.sent_at !== null || row.released_at !== null;
      return !(row.channel !== "email" && finished && claimed < cutoff && claimed < monthStart);
    });
    return before - this.deliveries.length;
  }

  async unreadNotificationCount(args: RpcContract["unreadNotificationCount"]["args"]): Promise<number> {
    return this.inbox.filter((n) => n.user_id === args.p_user && n.read_at === null).length;
  }

  /* ---------------- preferences ---------------- */

  async emailUnsubscribeStream(args: RpcContract["emailUnsubscribeStream"]["args"]) {
    // The database checks the stream first: an unknown or missing stream is refused whether or not the token matches.
    if (args.p_stream !== "announcements" && args.p_stream !== "promotions") throw fail("invalid_parameter", "22023", null, "emailUnsubscribeStream");
    const person = [...this.people.values()].find((p) => p.unsubscribeToken !== null && p.unsubscribeToken === args.p_token);
    if (!person) return { matched: false };
    const subscribed = args.p_subscribed ?? false;
    if (args.p_stream === "announcements") person.prefs.email_announcements = subscribed;
    else person.prefs.email_promotions = subscribed;
    return { matched: true };
  }

  /* ---------------- devices (signed-in caller) ---------------- */

  /** The functions a signed-in person calls with their own session. */
  forCaller(userId: string): SessionRpcs {
    return {
      registerPushSubscription: async (args) => {
        const rpc: RpcKey = "registerPushSubscription";
        const limits = NOTIFICATION_LIMITS;
        // The function is not strict: a missing endpoint, key, secret or browser is 22023, before any other check.
        if (args.p_endpoint == null || args.p_p256dh == null || args.p_auth == null || args.p_ua == null) throw fail("invalid_parameter", "22023", null, rpc);
        if (!args.p_endpoint.startsWith("https://")) throw refuse(rpc, "not_https");
        if (
          args.p_endpoint.length > limits.endpointMaxLength ||
          args.p_p256dh.length > limits.keyMaxLength ||
          args.p_auth.length > limits.keyMaxLength ||
          args.p_ua.length > limits.uaShortMaxLength
        ) {
          throw refuse(rpc, "value_too_long");
        }
        const zone = args.p_timezone === undefined || args.p_timezone === null || args.p_timezone === "" ? limits.defaultTimezone : args.p_timezone;
        // A present value must be an IANA name; it is refused, never replaced.
        if (zone.length > limits.timezoneMaxLength || !isKnownTimeZone(zone)) throw fail("invalid_parameter", "22023", null, rpc);

        const now = this.now().toISOString();
        const existing = this.devices.find((d) => d.endpoint === args.p_endpoint);
        const activeOthers = this.devices.filter((d) => d.user_id === userId && d.revoked_at === null && d !== existing);
        if (activeOthers.length >= limits.maxActiveDevices) throw refuse(rpc, "device_limit");

        if (existing && existing.user_id === userId) {
          // The caller's own device registering again: refreshed in place and revived.
          existing.p256dh = args.p_p256dh;
          existing.auth = args.p_auth;
          existing.ua_short = args.p_ua;
          existing.timezone = zone;
          existing.last_seen_at = now;
          existing.revoked_at = null;
          existing.revoke_reason = null;
          return existing.id;
        }
        if (existing) {
          // Someone else holds the endpoint: their row is kept, revoked (user) and made unusable, and the caller gets a new row (N1-R31 F5).
          existing.revoked_at = now;
          existing.revoke_reason = "user";
          existing.endpoint = `https://revoked.invalid/${existing.id}`;
          existing.p256dh = "revoked";
          existing.auth = "revoked";
        }
        const row = this.addDevice({ userId, endpoint: args.p_endpoint, timezone: zone });
        row.p256dh = args.p_p256dh;
        row.auth = args.p_auth;
        row.ua_short = args.p_ua;
        return row.id;
      },
    };
  }

  /** What a signed-in person sees of their own devices: the five safe columns, own rows only. */
  listDevices(userId: string): PushSubscriptionClientRow[] {
    return this.devices
      .filter((d) => d.user_id === userId)
      .map((d) => ({ id: d.id, ua_short: d.ua_short, created_at: d.created_at, last_seen_at: d.last_seen_at, revoked_at: d.revoked_at }));
  }

  /** A signed-in person's own-row delete. It filters by id and owner and returns how many rows it removed. */
  removeDevice(userId: string, deviceId: string): number {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => !(d.id === deviceId && d.user_id === userId));
    return before - this.devices.length;
  }

  /** Account deletion. Models the cascade only: every row that references the person goes with them. */
  deleteUser(userId: string): void {
    this.people.delete(userId);
    this.devices = this.devices.filter((d) => d.user_id !== userId);
    this.deliveries = this.deliveries.filter((d) => d.user_id !== userId);
    this.recipients = this.recipients.filter((r) => r.user_id !== userId);
    this.inbox = this.inbox.filter((n) => n.user_id !== userId);
  }

  /** A deletion request revokes the person's devices (reason `deleted`). */
  requestDeletion(userId: string): void {
    const person = this.people.get(userId);
    if (person) person.deletionRequested = true;
    const reason: PushRevokeReason = "deleted";
    for (const device of this.devices) {
      if (device.user_id === userId && device.revoked_at === null) {
        device.revoked_at = this.now().toISOString();
        device.revoke_reason = reason;
      }
    }
  }

  /* ---------------- admin messaging ---------------- */

  async resolveAdminSegment(args: RpcContract["resolveAdminSegment"]["args"]): Promise<string[]> {
    const rpc: RpcKey = "resolveAdminSegment";
    // The actor is required: a missing one is a caller error (22023), checked before the permission.
    if (args.p_actor === null || args.p_actor === undefined) throw fail("invalid_parameter", "22023", null, rpc);
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    if (!ADMIN_SEGMENT_KEYS.includes(args.p_key)) throw fail("invalid_parameter", "22023", null, rpc);
    const params = args.p_params;
    // Unknown parameter keys are refused, not ignored.
    if (Object.keys(params).some((key) => key !== "days" && key !== "since" && key !== "country")) {
      throw fail("invalid_parameter", "22023", null, rpc);
    }
    const now = this.now().getTime();
    const matches = [...this.people.values()].filter((person) => {
      if (person.deletionRequested || person.isQa) return false; // every segment
      switch (args.p_key) {
        case "everyone":
          return true;
        case "seekers":
          return person.role === "seeker";
        case "employers":
          return person.role === "employer";
        case "verified_employers":
          return person.role === "employer" && person.verifiedEmployer;
        case "inactive_seekers": {
          const days = params.days;
          if (days !== 30 && days !== 60 && days !== 90) throw fail("invalid_parameter", "22023", null, rpc);
          return person.role === "seeker" && person.lastActiveAt !== null && now - Date.parse(person.lastActiveAt) > days * DAY_MS;
        }
        case "signed_up_since": {
          if (!params.since || Number.isNaN(Date.parse(params.since))) throw fail("invalid_parameter", "22023", null, rpc);
          return Date.parse(person.createdAt) >= Date.parse(params.since);
        }
        case "country": {
          const wanted = (params.country ?? "").trim().toLowerCase();
          if (wanted === "" || wanted === "other") return false;
          return person.country !== null && person.country.trim().toLowerCase() === wanted;
        }
        case "self_test":
          return person.id === args.p_actor;
      }
    });
    return matches.map((person) => person.id);
  }

  async prepareAdminMessage(args: RpcContract["prepareAdminMessage"]["args"]): Promise<number> {
    const rpc: RpcKey = "prepareAdminMessage";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    if (message.status !== "draft") throw refuse(rpc, "invalid_state");
    if (!this.sendFlagsOn(message)) throw refuse(rpc, "flag_off");
    if (message.kind === "promotion" && (message.consent_line ?? "").trim() === "") throw refuse(rpc, "consent_required");

    const since = this.now().getTime() - DAY_MS;
    const started = this.messages.filter((m) => m.sent_started_at !== null && Date.parse(m.sent_started_at) > since);
    if (started.filter((m) => m.created_by === args.p_actor).length >= NOTIFICATION_LIMITS.adminPerOperatorPerDay) {
      throw refuse(rpc, "operator_daily_limit");
    }
    if (started.length >= NOTIFICATION_LIMITS.adminOverallPerDay) throw refuse(rpc, "overall_daily_limit");

    const ids = await this.resolveAdminSegment({
      p_actor: args.p_actor,
      p_key: message.segment_key,
      p_params: message.segment_params,
    });
    // The ceiling holds whatever the caller passes.
    const limit = Math.min(args.p_max_audience, NOTIFICATION_LIMITS.adminAudienceCeiling);
    if (ids.length > limit) throw refuse(rpc, "audience_over_limit");

    const stream: UnsubscribeStream = message.kind === "promotion" ? "promotions" : "announcements";
    const activeSince = this.now().getTime() - NOTIFICATION_LIMITS.adminEmailInactiveDays * DAY_MS;
    for (const id of ids) {
      const person = this.people.get(id);
      if (!person) continue;
      const hasDevice = this.devices.some((d) => d.user_id === id && d.revoked_at === null);
      const pushSwitch = message.kind === "promotion" ? person.prefs.push_promotions : true;
      this.recipients.push({
        id: this.newId(),
        message_id: message.id,
        user_id: id,
        to_inapp: message.channels.includes("inapp"),
        to_push: message.channels.includes("push") && person.prefs.push_enabled && pushSwitch && hasDevice,
        to_email:
          message.channels.includes("email") &&
          this.eligibleForEmail(person, stream) &&
          person.lastActiveAt !== null &&
          Date.parse(person.lastActiveAt) >= activeSince,
        push_outcome: null,
        email_outcome: null,
      });
    }
    message.audience_count = this.recipients.filter((r) => r.message_id === message.id).length;
    // A promotion, or more than 100 recipients, always needs approval; a flag already set is never lowered (N1-R30).
    message.requires_approval = message.requires_approval || message.kind === "promotion" || message.audience_count > 100;
    message.status = "prepared";
    this.addEvent(message.id, "prepared", {}, args.p_actor);
    return message.audience_count;
  }

  async submitAdminMessage(args: RpcContract["submitAdminMessage"]["args"]): Promise<void> {
    const rpc: RpcKey = "submitAdminMessage";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    if (message.status !== "prepared") throw refuse(rpc, "invalid_state");
    message.status = "submitted";
    this.addEvent(message.id, "submitted", {}, args.p_actor);
  }

  async approveAdminMessage(args: RpcContract["approveAdminMessage"]["args"]): Promise<void> {
    const rpc: RpcKey = "approveAdminMessage";
    const admin = this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    if (message.status !== "submitted") throw refuse(rpc, "invalid_state");
    if (message.created_by === args.p_actor) throw refuse(rpc, "self_approval");
    if (args.p_kind_confirmed !== message.kind) throw refuse(rpc, "kind_not_confirmed");
    message.status = "approved";
    message.approved_by = args.p_actor;
    message.approved_by_email = admin.email;
    message.kind_confirmed_by_approver = args.p_kind_confirmed;
    this.addEvent(message.id, "approved", { kind_confirmed: args.p_kind_confirmed }, args.p_actor);
  }

  async cancelAdminMessage(args: RpcContract["cancelAdminMessage"]["args"]): Promise<void> {
    const rpc: RpcKey = "cancelAdminMessage";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    if (message.status === "sending" || message.status === "sent" || message.status === "cancelled") {
      throw refuse(rpc, "invalid_state");
    }
    message.status = "cancelled";
    this.addEvent(message.id, "cancelled", {}, args.p_actor);
  }

  async startAdminMessageSend(args: RpcContract["startAdminMessageSend"]["args"]): Promise<string | null> {
    const rpc: RpcKey = "startAdminMessageSend";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    if (!this.sendFlagsOn(message)) {
      // One stop event per message until something else has happened to it (N1-R31 F8): the latest event of this message is already a stop, so nothing is added.
      const latest = [...this.events].reverse().find((e) => e.message_id === message.id);
      if (latest?.event !== "flag_stopped") this.addEvent(message.id, "flag_stopped", {}, args.p_actor);
      return null;
    }
    const startable = message.status === "approved" || (message.status === "prepared" && !message.requires_approval);
    if (!startable) return null; // a repeat or a double start sends nothing extra
    // The daily send limits count messages that have STARTED, so they are checked here too, by the message's creator and overall (N1-R31 F1).
    const since = this.now().getTime() - DAY_MS;
    const started = this.messages.filter((m) => m.sent_started_at !== null && Date.parse(m.sent_started_at) > since);
    if (message.created_by !== null && started.filter((m) => m.created_by === message.created_by).length >= NOTIFICATION_LIMITS.adminPerOperatorPerDay) throw refuse(rpc, "operator_daily_limit");
    if (started.length >= NOTIFICATION_LIMITS.adminOverallPerDay) throw refuse(rpc, "overall_daily_limit");
    message.status = "sending";
    message.sent_started_at = this.now().toISOString();
    this.addEvent(message.id, "send_started", {}, args.p_actor);
    return message.id;
  }

  async adminMessageAudit(args: RpcContract["adminMessageAudit"]["args"]): Promise<AdminMessageEventRow[]> {
    this.requirePermission(args.p_actor, "user_messaging", "adminMessageAudit");
    return this.events.filter((e) => !args.p_message || e.message_id === args.p_message).map((e) => ({ ...e }));
  }

  async recordAdminMessageTest(args: RpcContract["recordAdminMessageTest"]["args"]): Promise<void> {
    const rpc: RpcKey = "recordAdminMessageTest";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    // A test send never changes the message, so it cannot block the real send.
    this.addEvent(message.id, "test_sent", {}, args.p_actor);
  }

  async setNotificationSetting(args: RpcContract["setNotificationSetting"]["args"]): Promise<void> {
    const rpc: RpcKey = "setNotificationSetting";
    const admin = this.requirePermission(args.p_actor, "operators", rpc);
    if (!NOTIFICATION_SETTING_KEYS.includes(args.p_key)) throw refuse(rpc, "setting_key_unknown");
    if (!Number.isInteger(args.p_value) || args.p_value < 0 || args.p_value > NOTIFICATION_LIMITS.settingMax) {
      throw refuse(rpc, "setting_value_out_of_range");
    }
    const old = this.settings.find((row) => row.key === args.p_key)?.int_value ?? null;
    this.putSetting(args.p_key, args.p_value, admin.email);
    this.settingChanges.push({
      id: this.newId(),
      key: args.p_key,
      old_value: old,
      new_value: args.p_value,
      actor_admin_id: args.p_actor,
      actor_email: admin.email,
      at: this.now().toISOString(),
    });
  }

  async pauseAdminMessageSend(args: RpcContract["pauseAdminMessageSend"]["args"]): Promise<void> {
    const rpc: RpcKey = "pauseAdminMessageSend";
    const message = this.message(args.p_message, rpc);
    if (message.status !== "sending") throw refuse(rpc, "invalid_state");
    // Recipient rows keep their email outcome empty: nothing is dropped or failed.
    message.status = args.p_reason === "cap_24h" ? "paused_email_cap" : "paused_email_ceiling";
  }

  async resumeAdminMessageSend(args: RpcContract["resumeAdminMessageSend"]["args"]): Promise<void> {
    const rpc: RpcKey = "resumeAdminMessageSend";
    this.requirePermission(args.p_actor, "user_messaging", rpc);
    const message = this.message(args.p_message, rpc);
    if (!this.sendFlagsOn(message)) throw refuse(rpc, "flag_off");
    if (message.status !== "paused_email_cap" && message.status !== "paused_email_ceiling") throw refuse(rpc, "invalid_state");
    message.status = "sending";
    this.addEvent(message.id, "resumed", {}, args.p_actor);
  }

  async adminEmailEligibleRecipients(args: RpcContract["adminEmailEligibleRecipients"]["args"]): Promise<string[]> {
    return args.p_user_ids.filter((id) => {
      const person = this.people.get(id);
      return person !== undefined && this.eligibleForEmail(person, args.p_stream);
    });
  }

  /* ---------------- dispatch by database name ---------------- */

  /**
   * Calls a function as a given database role. Every function but the session-bound
   * one is executable by the service role only; any other caller gets 42501.
   */
  async invokeAs(
    role: "service_role" | "authenticated" | "anon",
    name: NotificationRpcName,
    args: unknown,
    caller?: string,
  ): Promise<unknown> {
    const key = (Object.keys(NOTIFICATION_RPCS) as RpcKey[]).find((k) => NOTIFICATION_RPCS[k] === name);
    if (!key) throw fail("invalid_parameter", "22023", null, "claimNotification");
    const allowed = key === "registerPushSubscription" ? role === "authenticated" : role === "service_role";
    if (!allowed) throw denied(key);
    return this.invoke(name, args, caller);
  }

  /**
   * Calls a function by its database name, the way a client's `rpc` would, so a
   * builder can stand the fake in for a client. Names come from the accessor
   * module's constants. Session-bound functions need `caller`.
   */
  async invoke(name: NotificationRpcName, args: unknown, caller?: string): Promise<unknown> {
    const key = (Object.keys(NOTIFICATION_RPCS) as RpcKey[]).find((k) => NOTIFICATION_RPCS[k] === name);
    if (!key) throw fail("invalid_parameter", "22023", null, "claimNotification");
    if (key === "registerPushSubscription") {
      if (!caller) throw denied(key);
      const call = this.forCaller(caller).registerPushSubscription as (a: unknown) => Promise<unknown>;
      return call(args);
    }
    const call = this[key] as (a: unknown) => Promise<unknown>;
    return call.call(this, args);
  }
}
