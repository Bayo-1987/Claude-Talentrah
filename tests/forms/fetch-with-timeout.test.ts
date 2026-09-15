/**
 * send-latency-timeout — the client-side half of the fix. tailor-form.tsx
 * (and every other component that calls a generateWithFailover-backed route)
 * used to catch every rejected fetch the same way and show "Couldn't reach
 * Farah — check your connection and try again." — wrong when the real cause
 * was the server taking too long, not the visitor's network. This pins the
 * classification `fetchErrorMessage`/`classifyFetchError` do, using the exact
 * error shapes named in the task: an aborted/timed-out request vs. a real
 * `TypeError: Failed to fetch` / offline browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyFetchError,
  fetchErrorMessage,
  fetchWithTimeout,
} from "@/lib/forms/fetch-with-timeout";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("classifyFetchError", () => {
  it("classifies an AbortError (DOMException) as a timeout", () => {
    expect(classifyFetchError(new DOMException("The operation was aborted.", "AbortError"))).toBe(
      "timeout",
    );
  });

  it("classifies a plain Error named AbortError as a timeout too", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyFetchError(err)).toBe("timeout");
  });

  it("classifies Chrome/Edge's TypeError('Failed to fetch') as a network failure", () => {
    expect(classifyFetchError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("classifies Safari's TypeError('Load failed') as a network failure", () => {
    expect(classifyFetchError(new TypeError("Load failed"))).toBe("network");
  });

  it("classifies an offline browser as a network failure regardless of the error shape", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(classifyFetchError(new Error("anything"))).toBe("network");
  });

  it("classifies anything else as unknown", () => {
    expect(classifyFetchError(new SyntaxError("Unexpected token < in JSON"))).toBe("unknown");
  });
});

describe("fetchErrorMessage", () => {
  it("shows the timeout copy for an aborted request, not the connection copy", () => {
    const message = fetchErrorMessage(new DOMException("aborted", "AbortError"));
    expect(message).toBe("This is taking longer than expected — try again in a moment.");
  });

  it("shows the connection copy only for a genuine network failure", () => {
    const message = fetchErrorMessage(new TypeError("Failed to fetch"));
    expect(message).toBe("Couldn't reach Farah — check your connection and try again.");
  });

  it("lets a caller override the network copy without changing the timeout copy", () => {
    const overrides = { network: "Upload failed — check your connection and try again." };
    expect(fetchErrorMessage(new TypeError("Failed to fetch"), overrides)).toBe(overrides.network);
    expect(fetchErrorMessage(new DOMException("aborted", "AbortError"), overrides)).toBe(
      "This is taking longer than expected — try again in a moment.",
    );
  });

  it("does not blame the connection for an unrecognised failure", () => {
    const message = fetchErrorMessage(new SyntaxError("Unexpected token"));
    expect(message).not.toMatch(/connection/i);
  });
});

describe("fetchWithTimeout", () => {
  it("aborts the underlying fetch once the timeout elapses", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise((_, reject) => {
          capturedSignal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );

    const promise = fetchWithTimeout("/api/tailoring", {}, 5000);
    let rejection: unknown;
    promise.catch((err) => {
      rejection = err;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(rejection).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(classifyFetchError(rejection)).toBe("timeout");
  });

  it("does not abort a fetch that resolves before the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    const res = await fetchWithTimeout("/api/tailoring", {}, 5000);
    expect(res.status).toBe(200);
  });
});
