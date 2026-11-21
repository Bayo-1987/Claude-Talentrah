/**
 * The admin mass-email path: what one email looks like, how a list is cut into requests, and how requests are paced. No database, no network, no secret in this file.
 *
 * It is a SEPARATE path from every existing sender on purpose. The existing senders call `emails.send` once per recipient and are guarded against deleted accounts by
 * `getResendClient()`; the batch endpoint is not covered by that guard, so the batch path does its own filtering (the database's email-eligibility function, asked before each batch) in
 * `src/lib/notifications/admin-messages/run-email.ts`. Nothing in this file calls `emails.send`, and tests/email/existing-senders-use-emails-send.test.ts keeps the other
 * direction true: no existing sender imports this file.
 */
import { absoluteUrl } from "@/lib/seo/site";
import { escEmail, emailButton, emailParagraph, renderBrandedEmail } from "@/lib/email/layout";
import { unsubscribeHeaders } from "@/lib/email/unsubscribe";
import { LOW_RATE_REMAINING, type MassSendIdentity } from "@/lib/email/mass-send-config";

export type MassStream = "announcements" | "promotions";

/** A promotion goes to the promotions stream; every other kind of message goes to announcements. */
export function streamFor(kind: string): MassStream {
  return kind === "promotion" ? "promotions" : "announcements";
}

/** One email object: exactly one recipient. The provider's batch endpoint takes an array of these. */
export type MassEmail = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

/** The one-click unsubscribe address of a recipient, built from that recipient's OWN token and the stream the mail belongs to. */
export function massUnsubscribeUrl(token: string, stream: MassStream): string {
  return absoluteUrl(`/unsubscribe?token=${encodeURIComponent(token)}&pref=${stream}`);
}

export type BuildMassEmailInput = {
  identity: MassSendIdentity;
  to: string;
  subject: string;
  body: string;
  linkPath: string | null;
  stream: MassStream;
  unsubscribeToken: string;
  /** The line a promotion carries about why the person receives it. Required for a promotion. */
  consentLine: string | null;
  firstName?: string | null;
};

export class MassEmailBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MassEmailBuildError";
  }
}

function paragraphsOf(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Builds the email for ONE recipient. Every email carries the unsubscribe footer made from the recipient's own token, and the one-click unsubscribe header pair (see
 * src/lib/email/unsubscribe.ts) that lets a mail client offer its own Unsubscribe button. A promotion also carries the consent line; a promotion without one cannot be built.
 */
export function buildMassEmail(input: BuildMassEmailInput): MassEmail {
  if (!input.unsubscribeToken) throw new MassEmailBuildError("a mass email needs the recipient's unsubscribe token");
  if (!input.to) throw new MassEmailBuildError("a mass email needs a recipient");
  const consent = (input.consentLine ?? "").trim();
  if (input.stream === "promotions" && !consent) throw new MassEmailBuildError("a promotion cannot be sent without its consent line");

  const unsubscribeUrl = massUnsubscribeUrl(input.unsubscribeToken, input.stream);
  const streamName = input.stream === "promotions" ? "promotions" : "announcements";

  const greeting = input.firstName && input.firstName.trim() ? `Hi ${input.firstName.trim()},` : "Hi,";
  const paragraphs = paragraphsOf(input.body);
  const linkUrl = input.linkPath ? absoluteUrl(input.linkPath) : null;

  const bodyHtml = [
    emailParagraph(escEmail(greeting)),
    ...paragraphs.map((p) => emailParagraph(escEmail(p).replace(/\n/g, "<br>"))),
    linkUrl ? emailButton("Open Talentrah", linkUrl) : "",
  ]
    .filter(Boolean)
    .join("\n");

  const footerHtml = [
    consent ? `${escEmail(consent)}<br>` : "",
    `<a href="${escEmail(unsubscribeUrl)}">Unsubscribe from ${streamName} emails</a>`,
  ].join("");

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    linkUrl ? `${linkUrl}\n` : "",
    "—",
    consent,
    `Unsubscribe from ${streamName} emails: ${unsubscribeUrl}`,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();

  // Both streams carry the one-click pair, pointing at the endpoint that accepts the POST (src/lib/email/unsubscribe.ts); the link in the body stays the confirm page.
  const headers: Record<string, string> = unsubscribeHeaders(input.unsubscribeToken, input.stream);

  return {
    from: input.identity.from,
    to: input.to,
    ...(input.identity.replyTo ? { replyTo: input.identity.replyTo } : {}),
    subject: input.subject,
    html: renderBrandedEmail({ bodyHtml, footerHtml }),
    text,
    headers,
  };
}

/** Cuts a list into requests of at most `perRequest`, keeping the order. 101 with 100 per request is a request of 100 and a request of 1. */
export function planBatches<T>(items: readonly T[], perRequest: number): T[][] {
  if (!Number.isInteger(perRequest) || perRequest < 1) throw new Error("perRequest must be a whole number of at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perRequest) out.push(items.slice(i, i + perRequest));
  return out;
}

/* ------------------------------------------------------------------ */
/* The provider port.                                                  */
/* ------------------------------------------------------------------ */

/** What the provider's response headers say. A field is null when its header was absent. */
export type QuotaReading = {
  /** Requests left in the provider's rate window. */
  rateRemaining: number | null;
  /** Emails the provider will still accept today. */
  dailyRemaining: number | null;
  /** Emails the provider will still accept this month. */
  monthlyRemaining: number | null;
};

/** The emails the provider says it will still accept, the smaller of its two quotas; null when neither header was present. */
export function quotaRoom(quota: QuotaReading | null): number | null {
  if (!quota) return null;
  const known = [quota.dailyRemaining, quota.monthlyRemaining].filter((n): n is number => typeof n === "number");
  return known.length === 0 ? null : Math.min(...known);
}

export type ProviderSendResult =
  /** The whole request was accepted. */
  | { kind: "ok"; quota: QuotaReading | null }
  /** HTTP 429: nothing was accepted; try again after `retryAfterSec`. */
  | { kind: "rate_limited"; retryAfterSec: number | null; quota: QuotaReading | null }
  /** The provider's daily or monthly quota is used up: nothing was accepted, and no retry today will help. */
  | { kind: "quota_exceeded"; scope: "daily" | "monthly" }
  /** The provider refused the whole request for what it contained. Nothing was sent. */
  | { kind: "rejected" }
  /** A timeout, a dropped connection or a server error: nobody knows whether the request was accepted. */
  | { kind: "unknown" };

export interface MassMailProvider {
  /** The provider's quota as its response headers report it, or null when they are absent. Read once, before the first request. */
  readQuota(): Promise<QuotaReading | null>;
  /** One request. The idempotency key makes a repeat of the SAME request safe. */
  sendBatch(emails: MassEmail[], options: { idempotencyKey: string }): Promise<ProviderSendResult>;
}

/* ------------------------------------------------------------------ */
/* Pacing.                                                             */
/* ------------------------------------------------------------------ */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Spaces requests: the start of one is at least `gapMs` after the start of the one before. Requests are awaited one at a time by the caller, so two are never in flight; this only
 * adds the wait. The gap is stretched when the provider reports that its rate window is nearly used.
 */
export function createPacer(clock: Clock, gapMs: number) {
  let lastStart: number | null = null;
  let extraGapMs = 0;
  return {
    /** Waits until a request may start, then marks it started. */
    async beforeRequest(): Promise<void> {
      if (lastStart !== null) {
        const wait = lastStart + gapMs + extraGapMs - clock.now();
        if (wait > 0) await clock.sleep(wait);
      }
      lastStart = clock.now();
      extraGapMs = 0;
    },
    /** Lets the provider's own report slow the next request: with few requests left in its window the gap doubles. */
    observe(quota: QuotaReading | null): void {
      if (quota && quota.rateRemaining !== null && quota.rateRemaining <= LOW_RATE_REMAINING) extraGapMs = gapMs;
    },
  };
}
