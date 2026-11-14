import { NOTIFICATION_FLAGS, type AdminMessageKind, type AdminMessageRow, type NotificationFlagKey, type NotificationPermission } from "@/lib/notifications/contract";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import type { EmailRunDeps } from "@/lib/notifications/admin-messages/run-email";
import type { EmailSendStore, RecipientDirectory, RecipientRecord } from "@/lib/notifications/admin-messages/ports";
import { resolveMassSendConfig, type MassSendConfig } from "@/lib/email/mass-send-config";
import type { Clock, MassEmail, MassMailProvider, ProviderSendResult, QuotaReading } from "@/lib/email/mass-send";

/**
 * A complete fake world for the email runner: the contract's in-memory database (which enforces the cap, the ceiling and the eligibility rules the way the database does), a fake
 * provider that records every request, a clock that is the database's own clock (so a pause in the runner moves the 24-hour window), and ports over the same people.
 *
 * Addresses are made here, in the directory, and nowhere else: the fake database never holds one, as the real one does not.
 */
export const CREATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const APPROVER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SUPER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** The test address of person n. The `zq7.` prefix is distinctive on purpose: a log test searches for it. */
export function addressOf(n: number): string {
  return `zq7.person${n}@example.test`;
}

export const GOOD_QUOTA: QuotaReading = { rateRemaining: 9, dailyRemaining: 10_000, monthlyRemaining: 100_000 };

export type ProviderRequest = { at: number; emails: MassEmail[]; key: string };

export function makeProvider(clock: Clock, script: ProviderSendResult[] = [], startQuota: QuotaReading | null = GOOD_QUOTA) {
  const requests: ProviderRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let quotaRead = 0;
  const provider: MassMailProvider = {
    async readQuota() {
      quotaRead += 1;
      return startQuota;
    },
    async sendBatch(emails, options) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      requests.push({ at: clock.now(), emails, key: options.idempotencyKey });
      await Promise.resolve();
      inFlight -= 1;
      return script.length > 0 ? script.shift()! : { kind: "ok", quota: null };
    },
  };
  return { provider, requests, maxInFlight: () => maxInFlight, quotaReads: () => quotaRead };
}

export type World = ReturnType<typeof makeWorld>;

export function makeWorld(
  opts: { people?: number; cap?: number; ceiling?: number; kind?: AdminMessageKind; config?: Partial<MassSendConfig>; start?: Date; script?: ProviderSendResult[]; quota?: QuotaReading | null; identity?: { from: string; replyTo: string | null } | null } = {},
) {
  const backend = new FakeNotificationBackend(opts.start ?? new Date("2026-10-26T12:00:00Z"));
  backend.addAdmin(CREATOR, "creator.operator@example.test", ["user_messaging"] as NotificationPermission[]);
  backend.addAdmin(APPROVER, "approver.operator@example.test", ["user_messaging"] as NotificationPermission[]);
  backend.addAdmin(SUPER, "super.operator@example.test", ["user_messaging", "operators"] as NotificationPermission[]);

  const flagState = new Map<string, boolean>();
  const setFlag = (key: NotificationFlagKey, on: boolean) => {
    flagState.set(key, on);
    backend.setFlag(key, on);
  };
  for (const key of Object.values(NOTIFICATION_FLAGS)) setFlag(key, true);
  setFlag(NOTIFICATION_FLAGS.adminPromotions, (opts.kind ?? "service_announcement") === "promotion");

  backend.putSetting("mass_email_cap_24h", opts.cap ?? 1000, null);
  backend.putSetting("mass_email_ceiling_month", opts.ceiling ?? 10000, null);

  const n = opts.people ?? 3;
  for (let i = 1; i <= n; i++) backend.addPerson({ id: uuid(i), unsubscribeToken: `tok-${i}`, prefs: { email_promotions: true } });

  const clock: Clock = {
    now: () => backend.now().getTime(),
    sleep: async (ms) => {
      backend.advance(ms);
    },
  };

  const store: EmailSendStore = {
    async getMessage(id) {
      const m = backend.messages.find((row) => row.id === id);
      return m ? { id: m.id, kind: m.kind, title: m.title, body: m.body, link_path: m.link_path, channels: m.channels, consent_line: m.consent_line, status: m.status } : null;
    },
    async queuedEmailRecipientIds(id) {
      return backend.recipients.filter((r) => r.message_id === id && r.to_email && r.email_outcome === null).map((r) => r.user_id).sort();
    },
    async setEmailOutcome(id, userIds, outcome) {
      for (const r of backend.recipients) if (r.message_id === id && userIds.includes(r.user_id)) r.email_outcome = outcome;
    },
  };

  const directory: RecipientDirectory = {
    async lookup(ids, stream) {
      const out = new Map<string, RecipientRecord>();
      for (const id of ids) {
        const p = backend.person(id);
        const index = Number.parseInt(id.slice(-12), 16);
        out.set(id, {
          present: p !== undefined,
          deleting: p?.deletionRequested ?? false,
          email: p && p.emailPresent ? addressOf(index) : null,
          unsubscribeToken: p?.unsubscribeToken ?? null,
          firstName: null,
          optedOut: p ? !(stream === "promotions" ? p.prefs.email_promotions : p.prefs.email_announcements) : true,
        });
      }
      return out;
    },
  };

  const fake = makeProvider(clock, opts.script ?? [], opts.quota === undefined ? GOOD_QUOTA : opts.quota);
  const logs: string[] = [];

  const deps: EmailRunDeps = {
    rpcs: backend,
    store,
    directory,
    provider: fake.provider,
    flags: async (key) => flagState.get(key) === true,
    clock,
    log: (line) => logs.push(line),
    identity: opts.identity === undefined ? { from: "Talentrah <announce@mail.example.test>", replyTo: null } : opts.identity,
    config: resolveMassSendConfig(opts.config),
  };

  /** Creates, prepares, submits, approves (by someone else) and starts a message to everyone. Returns the message in the `sending` state. */
  async function startedMessage(over: { kind?: AdminMessageKind; consentLine?: string | null; channels?: ("inapp" | "push" | "email")[] } = {}): Promise<AdminMessageRow> {
    const kind = over.kind ?? opts.kind ?? "service_announcement";
    const row = backend.addDraftMessage({
      createdBy: CREATOR,
      kind,
      channels: over.channels ?? ["email"],
      consentLine: kind === "promotion" ? (over.consentLine ?? "You receive this because you asked for promotions.") : null,
      title: "Platform notice",
      body: "First paragraph.\n\nSecond paragraph.",
    });
    await backend.prepareAdminMessage({ p_message: row.id, p_actor: CREATOR, p_max_audience: 500 });
    await backend.submitAdminMessage({ p_message: row.id, p_actor: CREATOR });
    await backend.approveAdminMessage({ p_message: row.id, p_actor: APPROVER, p_kind_confirmed: kind });
    await backend.startAdminMessageSend({ p_message: row.id, p_actor: CREATOR });
    return backend.messages.find((m) => m.id === row.id)!;
  }

  const outcomes = (messageId: string) => backend.recipients.filter((r) => r.message_id === messageId).map((r) => r.email_outcome);
  const queuedCount = (messageId: string) => backend.recipients.filter((r) => r.message_id === messageId && r.to_email && r.email_outcome === null).length;
  const sentAddresses = () => fake.requests.flatMap((r) => r.emails.map((e) => e.to));

  return { backend, deps, clock, fake, logs, setFlag, startedMessage, outcomes, queuedCount, sentAddresses, store, directory };
}
