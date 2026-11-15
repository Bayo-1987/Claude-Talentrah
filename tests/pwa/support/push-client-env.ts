/**
 * A fake browser for the page-side push client (src/lib/pwa/push/client.ts): only the edges are faked (permission, service worker, push manager, fetch, storage, clock), and every call is
 * recorded in order so a test can say what happened first. Every value is invented; the endpoint is a fake push-service URL.
 */
import { randomBytes } from "node:crypto";
import type { PushEnv } from "@/lib/pwa/push/client";
import { PUSH_WORKER_VERSION } from "@/lib/pwa/push/worker-version";

export const ENDPOINT = "https://push.example.test/send/FAKE-ENDPOINT-TOKEN";
/** A well-formed uncompressed P-256 public key in base64url (65 bytes). A public value, generated per run. */
export const VAPID_PUBLIC = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");

type Permission = "default" | "granted" | "denied";
export type FakeOpts = {
  permission?: Permission;
  /** What requestPermission() will answer. */
  answer?: Permission;
  ios?: boolean;
  standalone?: boolean;
  serviceWorker?: boolean;
  pushManager?: boolean;
  notification?: boolean;
  vapid?: string | undefined;
  /** An existing browser subscription. */
  subscribed?: boolean;
  /** The active worker's version answer; undefined = the default current version; null = the worker never answers (an old worker). */
  workerVersion?: string | null;
  noActiveWorker?: boolean;
  noRegistration?: boolean;
  status?: number;
  fetchThrows?: boolean;
  timezone?: string | null;
  storage?: Record<string, string>;
  now?: number;
  fetchHangs?: boolean;
};

export function fakeEnv(o: FakeOpts = {}) {
  const calls: string[] = [];
  const warns: unknown[][] = [];
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const storage: Record<string, string> = { ...(o.storage ?? {}) };
  let permission: Permission = o.permission ?? "default";
  let sub: null | { endpoint: string } = o.subscribed ? { endpoint: ENDPOINT } : null;
  const subscribeOptions: unknown[] = [];
  const makeSub = () => ({
    endpoint: ENDPOINT,
    toJSON: () => ({ keys: { p256dh: "FAKE-P256DH", auth: "FAKE-AUTH" } }),
    unsubscribe: async () => {
      calls.push("unsubscribe");
      sub = null;
      return true;
    },
  });
  const reg = {
    active: o.noActiveWorker ? null : { id: "worker" },
    pushManager: {
      getSubscription: async () => {
        calls.push("getSubscription");
        return sub ? makeSub() : null;
      },
      subscribe: async (options: unknown) => {
        calls.push("subscribe");
        subscribeOptions.push(options);
        sub = { endpoint: ENDPOINT };
        return makeSub();
      },
    },
  };
  const env: PushEnv = {
    vapidKey: "vapid" in o ? o.vapid : VAPID_PUBLIC,
    nav: { userAgent: o.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" : "Mozilla/5.0 (Linux; Android 14)", platform: o.ios ? "iPhone" : "Linux armv8l", maxTouchPoints: 5, standalone: o.ios ? !!o.standalone : undefined },
    isStandaloneDisplay: () => !!o.standalone,
    serviceWorker: o.serviceWorker === false ? undefined : { getRegistration: async () => (o.noRegistration ? undefined : reg), ready: Promise.resolve(reg) },
    hasPushManager: o.pushManager !== false,
    notification:
      o.notification === false
        ? undefined
        : {
            permission: () => permission,
            requestPermission: () => {
              calls.push("requestPermission");
              permission = o.answer ?? "granted";
              return Promise.resolve(permission);
            },
          },
    askWorkerVersion: async () => {
      calls.push("askWorkerVersion");
      return o.workerVersion === undefined ? PUSH_WORKER_VERSION : o.workerVersion;
    },
    fetch: async (url, init) => {
      calls.push(`fetch ${url}`);
      if (o.fetchHangs) return new Promise(() => undefined);
      if (o.fetchThrows) throw new Error(`network down ${ENDPOINT}`);
      posts.push({ url, body: JSON.parse(init.body) });
      const status = o.status ?? 200;
      return { ok: status >= 200 && status < 300, status };
    },
    timezone: () => (o.timezone === undefined ? "Africa/Lagos" : o.timezone),
    store: {
      getStamp: () => storage.stamp ?? null,
      setStamp: (v) => {
        storage.stamp = v;
      },
    },
    now: () => o.now ?? 1_800_000_000_000,
    warn: (...a) => {
      warns.push(a);
    },
  };
  return { env, calls, warns, posts, storage, subscribeOptions };
}
