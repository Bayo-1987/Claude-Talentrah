/** The part of web-push this repo calls. The package ships no types, and adding a types package would widen the lockfile beyond web-push and its own dependencies. */
declare module "web-push" {
  export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
  export type SendOptions = {
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    timeout?: number;
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
  };
  export type SendResult = { statusCode: number; body: string; headers: Record<string, string | string[] | undefined> };
  export class WebPushError extends Error {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
  }
  export function sendNotification(subscription: PushSubscriptionInput, payload: string, options?: SendOptions): Promise<SendResult>;
  const webpush: { sendNotification: typeof sendNotification; WebPushError: typeof WebPushError };
  export default webpush;
}
