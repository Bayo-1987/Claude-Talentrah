import { viewerTimeZone } from "@/lib/format/datetime";
import { PUSH_WORKER_VERSION, WORKER_VERSION_REQUEST } from "./worker-version";

/**
 * The page-side push client (U3b): is push available here, subscribe, reconcile at load, and the device timezone. It builds NO button and NO screen: the preferences screen (U6) mounts the
 * button and calls enablePush() from its click handler. Nothing here runs at load except reconcilePush(), and that only through the gate in gate.ts.
 *
 * Rules (spec 02 section 4, U7 addendum c):
 *  - Notification.requestPermission() is called directly in enablePush(), before any other await, so the click's user activation is still live. Nothing else in this file calls it, and a
 *    permission of "denied" is never prompted again.
 *  - Outside serviceWorker + PushManager + Notification (+ on iOS, standalone) the answer is "unsupported" / "needs_install" and nothing is prompted.
 *  - Before subscribing, the ACTIVE worker must be the expected version (a worker that never answers is an old one). No skipWaiting, no forced reload.
 *  - Nothing is ever logged with the endpoint or any personal data.
 */

export type PushState = "unsupported" | "needs_install" | "blocked" | "stale_worker" | "off" | "on";
export type EnableFailure = "unsupported" | "needs_install" | "blocked" | "dismissed" | "stale_worker" | "refused" | "signed_out" | "error";
export type EnableResult = { ok: true } | { ok: false; reason: EnableFailure };

/** Shown by U6 when the state is "stale_worker". */
export const STALE_WORKER_TEXT = "Close and reopen the app to turn on notifications";

const SUBSCRIBE_URL = "/api/push/subscribe";
const RECONCILE_STAMP = "talentrah-push-reconciled";
const DAY_MS = 24 * 60 * 60 * 1000;
const VERSION_WAIT_MS = 1000;
const REQUEST_WAIT_MS = 8000;
const READY_WAIT_MS = 5000;

type Permission = "default" | "granted" | "denied";
interface Sub {
  endpoint: string;
  toJSON(): { keys?: { p256dh?: string; auth?: string } };
  unsubscribe(): Promise<boolean>;
}
interface Reg {
  active: unknown | null;
  pushManager: { getSubscription(): Promise<Sub | null>; subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<Sub> };
}

/** The browser's edges, so a test can fake exactly these and nothing else. */
export interface PushEnv {
  vapidKey: string | undefined;
  nav: { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean };
  isStandaloneDisplay(): boolean;
  serviceWorker?: { getRegistration(): Promise<Reg | undefined>; ready: Promise<Reg> };
  hasPushManager: boolean;
  notification?: { permission(): Permission; requestPermission(): Promise<Permission> };
  askWorkerVersion(worker: unknown): Promise<string | null>;
  fetch(url: string, init: { method: "POST"; headers: Record<string, string>; credentials: "same-origin"; body: string }): Promise<{ ok: boolean; status: number }>;
  timezone(): string | null;
  /** The one local note: when this device last reconciled (named in the Data & Cookie Notice). */
  store: { getStamp(): string | null; setStamp(value: string): void };
  now(): number;
  warn(...args: unknown[]): void;
}

function browserEnv(): PushEnv {
  const w = window;
  return {
    // Written out in full: Next inlines NEXT_PUBLIC_ values only for this exact expression.
    vapidKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
    nav: w.navigator as unknown as PushEnv["nav"],
    isStandaloneDisplay: () => !!w.matchMedia?.("(display-mode: standalone)").matches,
    serviceWorker: w.navigator.serviceWorker as unknown as PushEnv["serviceWorker"],
    hasPushManager: "PushManager" in w,
    notification:
      typeof Notification === "undefined"
        ? undefined
        : { permission: () => Notification.permission as Permission, requestPermission: () => Notification.requestPermission() as Promise<Permission> },
    askWorkerVersion: (worker) =>
      new Promise<string | null>((resolve) => {
        try {
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve(null), VERSION_WAIT_MS);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve(typeof e.data === "string" ? e.data : null);
          };
          (worker as ServiceWorker).postMessage({ type: WORKER_VERSION_REQUEST }, [channel.port2]);
        } catch {
          resolve(null);
        }
      }),
    fetch: (url, init) => w.fetch(url, init),
    timezone: () => viewerTimeZone() ?? null,
    store: {
      getStamp: () => {
        try {
          return w.localStorage.getItem(RECONCILE_STAMP);
        } catch {
          return null;
        }
      },
      setStamp: (value) => {
        try {
          w.localStorage.setItem(RECONCILE_STAMP, value);
        } catch {
          // Blocked storage: the daily wait simply does not persist.
        }
      },
    },
    now: () => Date.now(),
    warn: (...a) => console.warn(...a),
  };
}

/** The device's timezone as an IANA name, or null when the browser will not say. */
export function deviceTimezone(): string | null {
  return browserEnv().timezone();
}

function isIos(nav: PushEnv["nav"]): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
}
function isStandalone(env: PushEnv): boolean {
  return env.nav.standalone === true || env.isStandaloneDisplay();
}
/** Synchronous: whether push can work here at all, and on iOS whether the app is installed. */
function availability(env: PushEnv): "ok" | "unsupported" | "needs_install" {
  if (!env.serviceWorker || !env.hasPushManager || !env.notification || !env.vapidKey) return "unsupported";
  if (isIos(env.nav) && !isStandalone(env)) return "needs_install";
  return "ok";
}

function keyBytes(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function workerIsCurrent(env: PushEnv, reg: Reg): Promise<boolean> {
  if (!reg.active) return false;
  return (await env.askWorkerVersion(reg.active)) === PUSH_WORKER_VERSION;
}

/** Where push stands on this device. Never prompts, never subscribes, never sends. */
export async function getPushState(env: PushEnv = browserEnv()): Promise<PushState> {
  try {
    const available = availability(env);
    if (available !== "ok") return available;
    if (env.notification!.permission() === "denied") return "blocked";
    const reg = await env.serviceWorker!.getRegistration();
    if (!reg) return "off";
    if (await reg.pushManager.getSubscription()) return "on";
    return (await workerIsCurrent(env, reg)) ? "off" : "stale_worker";
  } catch {
    return "unsupported";
  }
}

function subscribeBody(env: PushEnv, sub: Sub): string | null {
  const keys = sub.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) return null;
  const body: Record<string, string> = { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
  const timezone = env.timezone();
  if (timezone) body.timezone = timezone;
  return JSON.stringify(body);
}

function post(env: PushEnv, body: string): Promise<{ ok: boolean; status: number } | null> {
  return withTimeout(env.fetch(SUBSCRIBE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body }), REQUEST_WAIT_MS);
}

/**
 * Turn push on for this device. U6's button calls this from its click handler. Notification.requestPermission() is the first thing that happens (after only synchronous checks), so the
 * click's user activation is still live; a denied permission is reported as "blocked" without prompting again.
 */
export async function enablePush(env: PushEnv = browserEnv()): Promise<EnableResult> {
  const available = availability(env);
  if (available !== "ok") return { ok: false, reason: available };
  if (env.notification!.permission() === "denied") return { ok: false, reason: "blocked" };
  const permission = await env.notification!.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "blocked" : "dismissed" };
  try {
    const reg = await withTimeout(env.serviceWorker!.ready, READY_WAIT_MS);
    if (!reg) return { ok: false, reason: "error" };
    if (!(await workerIsCurrent(env, reg))) return { ok: false, reason: "stale_worker" };
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(env.vapidKey!) }));
    const body = subscribeBody(env, sub);
    if (!body) return { ok: false, reason: "error" };
    const res = await post(env, body);
    if (!res) {
      env.warn("push subscribe: no answer");
      return { ok: false, reason: "error" };
    }
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, reason: "signed_out" };
    if (res.status === 403) {
      // The flags are off or the kill switch is on: do not leave a browser subscription that nothing on the server knows about.
      if (!existing) await sub.unsubscribe().catch(() => undefined);
      return { ok: false, reason: "refused" };
    }
    env.warn("push subscribe: refused by the server", res.status);
    return { ok: false, reason: "error" };
  } catch {
    env.warn("push subscribe: failed");
    return { ok: false, reason: "error" };
  }
}

/**
 * At page load, for a browser that already opted in: say it again to the server (the same subscribe call) with the current timezone. It acts only when permission is already granted AND this
 * browser already has a subscription AND the worker is current; it never prompts, never creates a subscription, and sends at most once a day. It never throws.
 */
export async function reconcilePush(env: PushEnv = browserEnv()): Promise<void> {
  try {
    if (availability(env) !== "ok") return;
    if (env.notification!.permission() !== "granted") return;
    const last = Number(env.store.getStamp());
    if (Number.isFinite(last) && last > 0 && env.now() - last < DAY_MS) return;
    const reg = await env.serviceWorker!.getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    if (!(await workerIsCurrent(env, reg))) return;
    const body = subscribeBody(env, sub);
    if (!body) return;
    const res = await post(env, body);
    if (!res) return;
    env.store.setStamp(String(env.now()));
  } catch {
    env.warn("push reconcile: failed");
  }
}
