import { createHash } from "node:crypto";
import type { PushPayload, PushSendResult, PushSender, PushTarget } from "../contract";
import { toWireJson } from "./payload";

/** 24 hours, in seconds, as the push service counts a message's time to live. */
export const PUSH_TTL_SECONDS = 86_400;
export const PUSH_URGENCY = "normal" as const;
/** Backoff before the 1st, 2nd and 3rd retry of a server error or a network failure. */
export const BACKOFF_MS = [1000, 4000, 16000] as const;
export const RETRY_AFTER_CAP_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 1000;

export type PushTransportRequest = { endpoint: string; p256dh: string; auth: string; body: string; ttl: number; urgency: typeof PUSH_URGENCY };
/** What a push service answered. An HTTP status is a response, never a throw; only a failure to reach the service throws. */
export type PushTransportResponse = { status: number; retryAfter: string | null };
export type PushTransport = (request: PushTransportRequest) => Promise<PushTransportResponse>;

/**
 * The only things a log line may carry. The type is the rule: there is no field for an endpoint, a key, payload text, an email or a person, so a log call cannot be written that includes one.
 */
export type PushLogEvent = {
  event: string;
  notificationId?: string;
  endpointHash?: string;
  statusClass?: "2xx" | "3xx" | "4xx" | "5xx" | "network";
  attempt?: number;
  counts?: Record<string, number>;
};
export type PushLog = (event: PushLogEvent) => void;

/** The default log: one JSON line per event on the server console. */
export const consolePushLog: PushLog = (event) => {
  console.info(JSON.stringify({ scope: "push", ...event }));
};

/** Eight hex characters of a SHA-256 of the endpoint: enough to tell two devices apart in a log, not enough to find one. */
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 8);
}

function statusClass(status: number): PushLogEvent["statusClass"] {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  return "5xx";
}

/** Seconds as a number, or an HTTP date; anything else (empty, negative, text) waits 1 s. Never more than 60 s. */
function retryAfterMs(header: string | null): number {
  const value = header?.trim();
  if (!value) return DEFAULT_RETRY_AFTER_MS;
  let ms = Number.NaN;
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else {
    const date = Date.parse(value);
    if (!Number.isNaN(date)) ms = date - Date.now();
  }
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(ms, RETRY_AFTER_CAP_MS);
}

export function createPushSender(deps: { transport: PushTransport; sleep: (ms: number) => Promise<void>; log: PushLog }): PushSender {
  const { transport, sleep, log } = deps;
  return {
    async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
      const hash = endpointHash(target.endpoint);
      let body: string;
      try {
        body = toWireJson(payload);
      } catch {
        log({ event: "push_not_sent_payload", endpointHash: hash });
        return { outcome: "pre_send_failure" };
      }
      const request: PushTransportRequest = { endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth, body, ttl: PUSH_TTL_SECONDS, urgency: PUSH_URGENCY };

      let rateLimited = 0;
      for (let attempt = 1; ; attempt += 1) {
        let response: PushTransportResponse | null = null;
        try {
          response = await transport(request);
        } catch {
          log({ event: "push_attempt", endpointHash: hash, statusClass: "network", attempt });
        }
        let wait: number;
        if (response) {
          log({ event: "push_attempt", endpointHash: hash, statusClass: statusClass(response.status), attempt });
          const { status } = response;
          // Any 2xx is an accepted message; the push protocol answers 201, and a service that answers 200 or 202 has accepted it too.
          if (status >= 200 && status < 300) return { outcome: "sent" };
          if (status === 404 || status === 410) return { outcome: "gone" };
          if (status === 401 || status === 403) return { outcome: "our_key" };
          if (status === 413) return { outcome: "rejected_413" };
          if (status === 429) {
            // Honour Retry-After once. A second 429 means the service is still refusing us: give up rather than keep asking.
            if (rateLimited >= 1) return { outcome: "retries_exhausted" };
            rateLimited += 1;
            wait = retryAfterMs(response.retryAfter);
          } else if (status >= 500) wait = BACKOFF_MS[attempt - 1] ?? 0;
          else return { outcome: "pre_send_failure" };
        } else {
          wait = BACKOFF_MS[attempt - 1] ?? 0;
        }
        // At most three retries after the first attempt for a server error or a network failure; a 429 is retried once (above).
        if (attempt > BACKOFF_MS.length) return { outcome: "retries_exhausted" };
        await sleep(wait);
      }
    },
  };
}
