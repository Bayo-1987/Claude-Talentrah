/**
 * withNetworkFallback (src/lib/forms/with-network-fallback.ts) — the fix for
 * send-183's finding: a useActionState action that rejects (a request that
 * never reaches the server, e.g. an aborted/dropped connection) escalates
 * straight to the nearest Error Boundary instead of updating the hook's
 * state, which is what turned "the typed text survives a dead network"
 * (e2e/tracker-notes.spec.ts) into a crash instead of the error banner
 * notes-form.tsx already has for exactly this case.
 */
import { describe, expect, it, vi } from "vitest";
import { withNetworkFallback } from "@/lib/forms/with-network-fallback";

describe("withNetworkFallback", () => {
  it("passes through a normal resolved value untouched", async () => {
    const action = async (prev: string, extra: number) => `${prev}-${extra}`;
    const wrapped = withNetworkFallback(action, () => "fallback");

    await expect(wrapped("state", 1)).resolves.toBe("state-1");
  });

  it("catches a rejection and returns the fallback instead of throwing", async () => {
    const action = async () => {
      throw new Error("failed to fetch");
    };
    const wrapped = withNetworkFallback(action, () => "fallback-value");

    await expect(wrapped()).resolves.toBe("fallback-value");
  });

  it("hands the fallback the actual rejection reason, not a swallowed one", async () => {
    const boom = new Error("net::ERR_CONNECTION_REFUSED");
    const action = async () => {
      throw boom;
    };
    const onFailure = vi.fn(() => "fallback");
    const wrapped = withNetworkFallback(action, onFailure);

    await wrapped();
    expect(onFailure).toHaveBeenCalledWith(boom);
  });

  it("never itself rejects, even when the wrapped action rejects with a non-Error value", async () => {
    const action = async () => {
      // Real rejections aren't always Error instances (a thrown string, a
      // network stack rejecting with a plain object) — the wrapper must not
      // assume otherwise.
      throw "a string rejection";
    };
    const wrapped = withNetworkFallback(action, () => "fallback");

    await expect(wrapped()).resolves.toBe("fallback");
  });
});
