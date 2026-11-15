/**
 * U3b: the worker answers its version so the page can tell a stale active worker from a current one (U7 addendum c). The version constant lives in ONE module that both the worker source
 * and the page client import. The normal worker still has no skipWaiting, no clients.claim, and the new listener touches neither the network nor the caches.
 */
import { describe, expect, it } from "vitest";
import { WORKER_SOURCE } from "@/lib/pwa/service-worker-source";
import { PUSH_WORKER_VERSION } from "@/lib/pwa/push/worker-version";
import { loadWorker } from "./support/worker-harness";

const ask = (data: unknown, ports: Array<{ postMessage: (v: unknown) => void }> | undefined) => {
  const w = loadWorker(WORKER_SOURCE, {});
  (w.listeners.message as ((e: unknown) => void) | undefined)?.({ data, ports });
  return w;
};

describe("the worker's version answer", () => {
  it("registers a message listener", () => {
    expect(typeof loadWorker(WORKER_SOURCE, {}).listeners.message).toBe("function");
  });

  it("answers the version request on the port it was given, with exactly the shared constant", () => {
    const sent: unknown[] = [];
    ask({ type: "talentrah-worker-version" }, [{ postMessage: (v) => sent.push(v) }]);
    expect(sent).toEqual([PUSH_WORKER_VERSION]);
  });

  it("ignores any other message, and a version request with no port, without throwing", () => {
    const sent: unknown[] = [];
    for (const data of [undefined, null, "x", 5, { type: "other" }, { type: "talentrah-worker-version" }]) {
      expect(() => ask(data, data && (data as { type?: string }).type === "talentrah-worker-version" ? undefined : [{ postMessage: (v) => sent.push(v) }])).not.toThrow();
    }
    expect(sent).toEqual([]);
  });

  it("the constant is a non-empty string", () => {
    expect(typeof PUSH_WORKER_VERSION).toBe("string");
    expect(PUSH_WORKER_VERSION.length).toBeGreaterThan(0);
  });

  it("the message listener uses neither fetch( nor caches., and does not skipWaiting or claim", () => {
    const start = WORKER_SOURCE.indexOf('self.addEventListener("message"');
    expect(start).toBeGreaterThan(-1);
    const end = WORKER_SOURCE.indexOf("\n});\n", start) + 5;
    const listener = WORKER_SOURCE.slice(start, end);
    expect(listener).not.toMatch(/fetch\(|caches\.|skipWaiting|clients\.claim/);
  });
});
