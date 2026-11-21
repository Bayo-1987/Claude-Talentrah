import {
  ADMIN_MESSAGE_KINDS,
  ADMIN_SEGMENT_KEYS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FLAGS,
  NOTIFICATION_LIMITS,
  NOTIFICATION_SETTING_KEYS,
  STALE_CLAIM_MIN_AGE_MINUTES,
  STALE_CLAIM_RESOLUTIONS,
  type AdminMessageEventRow,
  type AdminMessageKind,
  type AdminMessageRow,
  type AdminSegmentKey,
  type AdminSegmentParams,
  type NotificationChannel,
  type NotificationFlagKey,
  type NotificationSettingKey,
  type StaleClaimResolution,
  type StaleClaimRow,
} from "@/lib/notifications/contract";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { requireHolder, type AdminActor } from "./actor";
import { MessagingError } from "./errors";
import type { ChannelCounts, EmailLimits, MessagingReads } from "./reads";
import type { MessagingRpcs } from "./rpcs";
import { isSelfApproved } from "./self-send";

/**
 * The admin messaging service (A1). It is the only thing the admin page and its Server Actions call, and it has NO bypass:
 *   - every operation takes the acting admin from the caller's verified session (`AdminActor`), checks the permission BEFORE any database call, and passes the actor id to the database function as its argument;
 *   - the flags are read BEFORE any database call on the send path (the database checks them again), so with admin_messaging off nothing reaches the database at all;
 *   - the rules that belong to the database (the two-person rule, the kind confirmation, the state graph, the daily limits, the audience limits) are NOT re-implemented here: the database's refusal comes back as `refused` with
 *     its closed reason. The approver cannot be the creator because the database says so, not because this file does.
 */
export type MessagingFlags = (key: NotificationFlagKey) => Promise<boolean>;

export interface MessagingDeps {
  rpcs: MessagingRpcs;
  reads: MessagingReads;
  flags: MessagingFlags;
  now?: () => Date;
}

export interface ComposeInput {
  kind: AdminMessageKind;
  title: string;
  body: string;
  /** A same-origin path, or null. */
  linkPath: string | null;
  channels: NotificationChannel[];
  segmentKey: AdminSegmentKey;
  segmentParams: AdminSegmentParams;
  /** Required for a promotion. */
  consentLine: string | null;
}

export interface Switches {
  /** admin_messaging: the flag every action needs. (The database also requires the master switch and refuses with flag_off, which comes back as switched off.) */
  sendPathOpen: boolean;
  promotionsOn: boolean;
  emailOn: boolean;
}

const LINK_REFUSED = "\\u0000-\\u001f\\u007f-\\u009f \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\\\";
const LINK_PATH = new RegExp(`^/([^/${LINK_REFUSED}][^${LINK_REFUSED}]*)?$`);
const LINK_MAX = 200;

function invalid(message: string): MessagingError {
  return new MessagingError("invalid_input", message);
}

/** The database's refusal as ours: code, closed reason, and a message that carries no database text and no person's data. */
function fromDatabase(error: unknown): never {
  if (error instanceof NotificationDbError) {
    const { code, reason } = error.info;
    if (code === "permission_denied") throw new MessagingError("permission_denied", "the database refused: no permission");
    if (code === "invalid_parameter") throw new MessagingError("invalid_input", "the database refused a value");
    // the database checks the flags too (the master switch among them): a flag it found off is the same answer as ours, not an error
    if (reason === "flag_off") throw new MessagingError("switched_off", "admin messaging is switched off", reason);
    throw new MessagingError("refused", reason ? `the database refused (${reason})` : "the database refused", reason);
  }
  throw error;
}
async function viaDatabase<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    return fromDatabase(error);
  }
}

export function validateCompose(input: ComposeInput): void {
  if (!ADMIN_MESSAGE_KINDS.includes(input.kind)) throw invalid("unknown message kind");
  if (typeof input.title !== "string" || input.title.trim() === "" || input.title.length > NOTIFICATION_LIMITS.titleMaxLength) throw invalid(`the title is 1 to ${NOTIFICATION_LIMITS.titleMaxLength} characters`);
  if (typeof input.body !== "string" || input.body.trim() === "" || input.body.length > NOTIFICATION_LIMITS.bodyMaxLength) throw invalid(`the body is 1 to ${NOTIFICATION_LIMITS.bodyMaxLength} characters`);
  if (input.linkPath !== null && (typeof input.linkPath !== "string" || input.linkPath.length > LINK_MAX || !LINK_PATH.test(input.linkPath))) throw invalid("the link must be a path on this site");
  if (!Array.isArray(input.channels) || input.channels.length < 1) throw invalid("pick at least one channel");
  if (new Set(input.channels).size !== input.channels.length) throw invalid("a channel is listed twice");
  if (input.channels.some((c) => !NOTIFICATION_CHANNELS.includes(c))) throw invalid("unknown channel");
  if (!ADMIN_SEGMENT_KEYS.includes(input.segmentKey)) throw invalid("unknown audience");
  if (input.kind === "promotion" && (input.consentLine ?? "").trim() === "") throw invalid("a promotion needs its consent line");
}

export function createMessagingService(deps: MessagingDeps) {
  const { rpcs, reads, flags } = deps;
  const now = deps.now ?? (() => new Date());

  async function switches(): Promise<Switches> {
    const [messaging, promotions, email] = await Promise.all([
      flags(NOTIFICATION_FLAGS.adminMessaging),
      flags(NOTIFICATION_FLAGS.adminPromotions),
      flags(NOTIFICATION_FLAGS.adminEmail),
    ]);
    return { sendPathOpen: messaging, promotionsOn: promotions, emailOn: email };
  }

  /** Every action needs admin_messaging. admin_promotions is asked only for a promotion, admin_email only for the email channel (per case, never blanket). */
  async function requireSendPath(): Promise<Switches> {
    const s = await switches();
    if (!s.sendPathOpen) throw new MessagingError("switched_off", "admin messaging is switched off");
    return s;
  }

  /** What the message's kind and channels need switched on, read before the database is asked. */
  function requireSwitchesFor(s: Switches, kind: AdminMessageKind, channels: readonly NotificationChannel[]): void {
    if (kind === "promotion" && !s.promotionsOn) throw new MessagingError("switched_off", "promotions are switched off");
    if (channels.includes("email") && !s.emailOn) throw new MessagingError("switched_off", "admin email is switched off");
  }

  /** admin_messaging_self_approve. Off when absent and when it cannot be read: a flag that cannot be read is off. */
  async function selfApproveOn(): Promise<boolean> {
    try {
      return (await flags(NOTIFICATION_FLAGS.adminMessagingSelfApprove)) === true;
    } catch {
      return false;
    }
  }

  async function messageOrNull(id: string): Promise<AdminMessageRow | null> {
    return reads.getMessage(id);
  }

  return {
    async switches(actor: AdminActor): Promise<Switches> {
      requireHolder(actor, "user_messaging");
      return switches();
    },

    async compose(actor: AdminActor, input: ComposeInput): Promise<string> {
      requireHolder(actor, "user_messaging");
      validateCompose(input);
      const s = await requireSendPath();
      requireSwitchesFor(s, input.kind, input.channels);
      // One operator may send without a second approver only when the flag is on and the message is not a promotion. With the flag off the create function gets exactly the arguments it always got (and
      // defaults to needing approval). The database still raises the requirement for an audience over 100 when the audience is frozen.
      const withoutSecondApprover = input.kind !== "promotion" && (await selfApproveOn());
      return viaDatabase(() =>
        rpcs.createAdminMessage({
          p_actor: actor.adminId,
          p_kind: input.kind,
          p_title: input.title,
          p_body: input.body,
          p_link_path: input.linkPath,
          p_channels: [...input.channels],
          p_segment_key: input.segmentKey,
          p_segment_params: { ...input.segmentParams },
          p_consent_line: input.consentLine,
          ...(withoutSecondApprover ? { p_requires_approval: false } : {}),
        }),
      );
    },

    /** Freezes the audience. The count comes back; the people never do. */
    async prepare(actor: AdminActor, messageId: string, maxAudience: number = NOTIFICATION_LIMITS.adminAudienceDefaultMax): Promise<number> {
      requireHolder(actor, "user_messaging");
      await requireSendPath();
      return viaDatabase(() => rpcs.prepareAdminMessage({ p_message: messageId, p_actor: actor.adminId, p_max_audience: maxAudience }));
    },

    async submit(actor: AdminActor, messageId: string): Promise<void> {
      requireHolder(actor, "user_messaging");
      await requireSendPath();
      return viaDatabase(() => rpcs.submitAdminMessage({ p_message: messageId, p_actor: actor.adminId }));
    },

    /** The kind confirmation is the approver's own tick: it must equal the message's kind or the database refuses (kind_not_confirmed). */
    async approve(actor: AdminActor, messageId: string, kindConfirmed: AdminMessageKind): Promise<void> {
      requireHolder(actor, "user_messaging");
      await requireSendPath();
      return viaDatabase(() => rpcs.approveAdminMessage({ p_message: messageId, p_actor: actor.adminId, p_kind_confirmed: kindConfirmed }));
    },

    /** Cancelling is a stop, so it stays possible with the flags off. */
    async cancel(actor: AdminActor, messageId: string): Promise<void> {
      requireHolder(actor, "user_messaging");
      return viaDatabase(() => rpcs.cancelAdminMessage({ p_message: messageId, p_actor: actor.adminId }));
    },

    /** The message id when this call started the send; null on a repeat. Starting records the state; the sender (A2) does the sending. */
    async start(actor: AdminActor, messageId: string): Promise<string | null> {
      requireHolder(actor, "user_messaging");
      const s = await requireSendPath();
      const message = await messageOrNull(messageId);
      if (message) requireSwitchesFor(s, message.kind, message.channels);
      // A message made without a second approver also needs the flag at the moment of sending: switching it off stops such a message even though the database would let it start.
      if (message && isSelfApproved(message) && !(await selfApproveOn())) throw new MessagingError("switched_off", "sending without a second approver is switched off");
      return viaDatabase(() => rpcs.startAdminMessageSend({ p_message: messageId, p_actor: actor.adminId }));
    },

    /** Records that the operator sent themselves a test. The test itself reaches only the operator (see the sender). */
    async recordTest(actor: AdminActor, messageId: string): Promise<void> {
      requireHolder(actor, "user_messaging");
      await requireSendPath();
      return viaDatabase(() => rpcs.recordAdminMessageTest({ p_message: messageId, p_actor: actor.adminId }));
    },

    /** The only way a paused message continues: an explicit, audited action. Raising a limit never calls this. */
    async resume(actor: AdminActor, messageId: string): Promise<void> {
      requireHolder(actor, "user_messaging");
      const s = await requireSendPath();
      const message = await messageOrNull(messageId);
      if (message) requireSwitchesFor(s, message.kind, message.channels);
      return viaDatabase(() => rpcs.resumeAdminMessageSend({ p_message: messageId, p_actor: actor.adminId }));
    },

    async audit(actor: AdminActor, messageId: string): Promise<AdminMessageEventRow[]> {
      requireHolder(actor, "user_messaging");
      return viaDatabase(() => rpcs.adminMessageAudit({ p_actor: actor.adminId, p_message: messageId }));
    },

    /** Open email claims older than the minimum age: ids, kind and time. No person, no address. */
    async staleEmailClaims(actor: AdminActor): Promise<StaleClaimRow[]> {
      requireHolder(actor, "user_messaging");
      return viaDatabase(() => rpcs.staleNotificationClaims({ p_channel: "email", p_older_than: `${STALE_CLAIM_MIN_AGE_MINUTES} minutes` }));
    },

    async resolveStaleClaim(actor: AdminActor, claimId: string, resolution: StaleClaimResolution): Promise<void> {
      requireHolder(actor, "user_messaging");
      if (!STALE_CLAIM_RESOLUTIONS.includes(resolution)) throw invalid("unknown resolution");
      return viaDatabase(() => rpcs.resolveStaleClaim({ p_id: claimId, p_actor: actor.adminId, p_resolution: resolution }));
    },

    async limits(actor: AdminActor): Promise<EmailLimits> {
      requireHolder(actor, "user_messaging");
      return reads.emailLimits(now());
    },

    /** Super Admin only (the operators permission). The database re-checks the permission, the key and the range and writes the change log. */
    async setLimit(actor: AdminActor, key: NotificationSettingKey, value: number): Promise<void> {
      requireHolder(actor, "operators");
      if (!NOTIFICATION_SETTING_KEYS.includes(key)) throw invalid("unknown setting");
      if (!Number.isInteger(value)) throw invalid("the limit is a whole number");
      return viaDatabase(() => rpcs.setNotificationSetting({ p_key: key, p_value: value, p_actor: actor.adminId }));
    },

    async list(actor: AdminActor, limit = 50): Promise<AdminMessageRow[]> {
      requireHolder(actor, "user_messaging");
      return reads.listMessages(limit);
    },

    async get(actor: AdminActor, messageId: string): Promise<AdminMessageRow | null> {
      requireHolder(actor, "user_messaging");
      return reads.getMessage(messageId);
    },

    async channelCounts(actor: AdminActor, messageId: string): Promise<ChannelCounts> {
      requireHolder(actor, "user_messaging");
      return reads.channelCounts(messageId);
    },
  };
}

export type MessagingService = ReturnType<typeof createMessagingService>;
