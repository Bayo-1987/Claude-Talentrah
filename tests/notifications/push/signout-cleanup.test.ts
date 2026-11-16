/**
 * U7: before the session ends, the page unsubscribes THIS browser from push and asks the server route to delete the matching row. It never throws, never waits past the bound, logs
 * without the endpoint, and with no subscription (the only state while the push flags are off) it does nothing at all. Only the browser's edges are faked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_BOUND_MS, cleanupPushForSignOut, type CleanupEnv } from "@/lib/notifications/push/signout-cleanup";

const ENDPOINT = "https://push.example.test/send/SECRET-ENDPOINT-TOKEN";

function env(over: Partial<CleanupEnv> & { endpoint?: string | null; unsubscribe?: () => Promise<boolean> } = {}) {
  const calls: string[] = [];
  const logs: unknown[][] = [];
  const unsubscribe = over.unsubscribe ?? (async () => { calls.push("unsubscribe"); return true; });
  const e: CleanupEnv = {
    getSubscription: over.getSubscription ?? (async () => (over.endpoint === null ? null : { endpoint: over.endpoint ?? ENDPOINT, unsubscribe })),
    fetch: over.fetch ?? (async (url, init) => { calls.push(`fetch ${url} ${init.method} ${init.body}`); return { ok: true }; }),
    warn: over.warn ?? ((...a: unknown[]) => { logs.push(a); }),
  };
  return { e, calls, logs };
}

afterEach(() => vi.useRealTimers());

describe("cleanupPushForSignOut", () => {
  it("sign-out unsubscribes the browser's push subscription and removes this device's row", async () => {
    const { e, calls } = env();
    await cleanupPushForSignOut(e);
    expect(calls).toEqual(["unsubscribe", `fetch /api/push/unsubscribe POST ${JSON.stringify({ endpoint: ENDPOINT })}`]);
  });

  it("the route call has finished before the helper returns (the sign-out form waits on it)", async () => {
    let finished = false;
    const { e } = env({ fetch: async () => { await new Promise((r) => setTimeout(r, 5)); finished = true; return { ok: true }; } });
    await cleanupPushForSignOut(e);
    expect(finished).toBe(true);
  });

  it("no subscription: no unsubscribe and no request at all", async () => {
    const { e, calls } = env({ endpoint: null });
    await cleanupPushForSignOut(e);
    expect(calls).toEqual([]);
  });

  it("no service worker or push support (getSubscription refuses): no request, no throw", async () => {
    const { e, calls } = env({ getSubscription: async () => { throw new Error("unsupported"); } });
    await expect(cleanupPushForSignOut(e)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("a failed delete does not block: it resolves, and the log carries no endpoint", async () => {
    const { e, logs } = env({ fetch: async () => { throw new Error(`boom ${ENDPOINT}`); } });
    await expect(cleanupPushForSignOut(e)).resolves.toBeUndefined();
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("SECRET-ENDPOINT-TOKEN");
    expect(JSON.stringify(logs)).not.toContain("push.example.test");
  });

  it("a non-ok answer from the route does not block, and is logged without the endpoint", async () => {
    const { e, logs } = env({ fetch: async () => ({ ok: false }) });
    await expect(cleanupPushForSignOut(e)).resolves.toBeUndefined();
    expect(JSON.stringify(logs)).not.toContain("SECRET-ENDPOINT-TOKEN");
  });

  it("a failed unsubscribe still asks the server to delete the row", async () => {
    const { e, calls } = env({ unsubscribe: async () => { throw new Error("refused"); } });
    await cleanupPushForSignOut(e);
    expect(calls.some((c) => c.startsWith("fetch /api/push/unsubscribe"))).toBe(true);
  });

  it("a cleanup that waits past the bound does not block sign-out", async () => {
    vi.useFakeTimers();
    const { e } = env({ fetch: () => new Promise(() => undefined) });
    let done = false;
    const p = cleanupPushForSignOut(e).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(CLEANUP_BOUND_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it("the bound is 2000 ms", () => {
    expect(CLEANUP_BOUND_MS).toBe(2000);
  });
});
