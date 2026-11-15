/**
 * Shared helpers for the U4 push tests. Nothing here is a real credential: key pairs are generated at run time with node:crypto, and every endpoint is a made-up https address that exists in no push service.
 */
import { createECDH, randomBytes } from "node:crypto";
import type { PushTarget } from "@/lib/notifications/contract";
import type { PushLogEvent, PushTransport, PushTransportRequest, PushTransportResponse } from "@/lib/notifications/push/sender";

const b64url = (buffer: Buffer) => buffer.toString("base64url");

/** A fresh, valid VAPID pair in the web-push wire format (65-byte uncompressed public point, 32-byte private scalar, both base64url). */
export function makeVapidPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** An endpoint-shaped value that is unique per call, so a leak test can search for it. */
export function makeEndpoint(): string {
  return `https://push.example.test/send/${randomBytes(18).toString("hex")}`;
}

export function makeTarget(over: Partial<PushTarget> = {}): PushTarget {
  return {
    deviceId: `00000000-0000-4000-8000-${randomBytes(6).toString("hex")}`,
    endpoint: makeEndpoint(),
    p256dh: `p${randomBytes(30).toString("base64url")}`,
    auth: `a${randomBytes(12).toString("base64url")}`,
    ...over,
  };
}

/** A transport that answers from a script, in order, and records every request. A scripted Error is thrown (a network failure). The last script entry repeats. */
export function scriptedTransport(script: Array<number | { status: number; retryAfter: string } | Error>) {
  const requests: PushTransportRequest[] = [];
  let index = 0;
  const transport: PushTransport = async (request) => {
    requests.push(request);
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    const response: PushTransportResponse = typeof step === "number" ? { status: step, retryAfter: null } : { status: step.status, retryAfter: step.retryAfter };
    return response;
  };
  return { transport, requests };
}

/** A sleep that records the requested delays and never waits. */
export function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

export function recordingLog() {
  const events: PushLogEvent[] = [];
  return { events, log: (event: PushLogEvent) => void events.push(event) };
}
