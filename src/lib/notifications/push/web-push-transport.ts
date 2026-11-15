import webpush from "web-push";
import type { PushTransport } from "./sender";
import type { VapidConfig } from "./vapid";

const SEND_TIMEOUT_MS = 10_000;

function header(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | null {
  const value = headers?.[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * The only file that imports web-push. An HTTP status from the push service is returned as a response (the failure table in sender.ts decides what it means); only a failure to reach the service
 * throws. The thrown error is never read or logged by the caller, because web-push's own messages can carry the endpoint.
 */
export function createWebPushTransport(config: VapidConfig): PushTransport {
  return async (request) => {
    try {
      const result = await webpush.sendNotification({ endpoint: request.endpoint, keys: { p256dh: request.p256dh, auth: request.auth } }, request.body, {
        TTL: request.ttl,
        urgency: request.urgency,
        timeout: SEND_TIMEOUT_MS,
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      });
      return { status: result.statusCode, retryAfter: header(result.headers, "retry-after") };
    } catch (error) {
      if (error instanceof webpush.WebPushError && typeof error.statusCode === "number") {
        return { status: error.statusCode, retryAfter: header(error.headers, "retry-after") };
      }
      throw error;
    }
  };
}
