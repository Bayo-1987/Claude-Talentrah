/**
 * Sign-out cleanup for push (U7). A push subscription belongs to the browser profile, not the person, and the service worker outlives the session, so BEFORE the session ends the page
 * (1) unsubscribes this browser from push and (2) asks POST /api/push/unsubscribe to delete this device's row (the route needs the live session, which is why this runs first).
 *
 * It never throws and never waits past CLEANUP_BOUND_MS: a failure or a slow network must not stop a person signing out. A failure is logged as a step name only, never the endpoint or
 * anything personal; the row is then left for the sender's own cleanup (a 404 or 410 from the push service removes it). With no subscription (the only state while the push flags are off)
 * it asks for nothing.
 */

/** The longest the sign-out waits for this cleanup. */
export const CLEANUP_BOUND_MS = 2000;

export type CleanupSubscription = { endpoint: string; unsubscribe(): Promise<boolean> };
export type CleanupEnv = {
  /** This browser's push subscription, or null. May throw where push is unsupported. */
  getSubscription(): Promise<CleanupSubscription | null>;
  fetch(url: string, init: { method: "POST"; headers: Record<string, string>; credentials: "same-origin"; body: string }): Promise<{ ok: boolean }>;
  warn(...args: unknown[]): void;
};

function browserEnv(): CleanupEnv {
  return {
    getSubscription: async () => {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      return (await reg?.pushManager?.getSubscription?.()) ?? null;
    },
    fetch: (url, init) => fetch(url, init),
    warn: (...args) => console.warn(...args),
  };
}

async function run(env: CleanupEnv): Promise<void> {
  let sub: CleanupSubscription | null;
  try {
    sub = await env.getSubscription();
  } catch {
    return; // No service worker or push support here: nothing to clean.
  }
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    env.warn("push sign-out cleanup: unsubscribe failed");
  }
  try {
    const res = await env.fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) env.warn("push sign-out cleanup: server delete refused");
  } catch {
    env.warn("push sign-out cleanup: server delete failed");
  }
}

export async function cleanupPushForSignOut(env: CleanupEnv = browserEnv()): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLEANUP_BOUND_MS);
  });
  try {
    await Promise.race([run(env).catch(() => undefined), bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
