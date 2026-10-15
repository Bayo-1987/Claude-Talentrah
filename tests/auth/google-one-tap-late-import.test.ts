/**
 * GoogleOneTap when the Supabase client chunk is SLOW or FAILS (PERF-ONE-TAP-DYNAMIC-1).
 *
 * tests/auth/google-one-tap-flow.test.ts covers the effect with a chunk that arrives at once. These cover the two edges that only exist because the client is now a dynamic import:
 *  - the chunk arrives late: the prompt must still be reached once it does, and nothing the popup needs (the nonce, Google's script) may run ahead of the session check it gates;
 *  - the chunk fails to load, or arrives after the effect was cleaned up: nothing throws, nothing is left unhandled, and no client, nonce or Google script is started.
 * Same harness shape as the flow test (useEffect captured, the real component called directly, stubbed window/document); only the client module is made slow or broken here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  nonce: vi.fn(async () => ({ nonce: "raw-nonce", hashedNonce: "hashed-nonce" })),
}));

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useEffect: (fn: () => void | (() => void)) => void h.effects.push(fn) }));
vi.mock("@/lib/auth/one-tap-actions", () => ({ getOneTapNonceAction: h.nonce }));
vi.mock("@/lib/auth/one-tap-events", () => ({ oneTapMomentAction: vi.fn(async () => undefined) }));

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
let gsi: { initialize: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
let win: { google?: unknown; location: { search: string; pathname: string; assign: ReturnType<typeof vi.fn> } };
let scriptAppended: number;
let envBefore: string | undefined;
const unhandled = vi.fn();

function stubBrowser() {
  gsi = { initialize: vi.fn(), prompt: vi.fn(), cancel: vi.fn() };
  scriptAppended = 0;
  win = { location: { search: "", pathname: "/login", assign: vi.fn() } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { userAgent: "test-agent" });
  vi.stubGlobal("document", {
    getElementById: () => null,
    createElement: () => ({}) as Record<string, unknown>,
    head: {
      appendChild: (script: { onload?: () => void }) => {
        scriptAppended++;
        queueMicrotask(() => {
          win.google = { accounts: { id: gsi } };
          script.onload?.();
        });
      },
    },
  });
}

/** Mounts the component with a client module that settles only when told to: `release()` resolves it, `fail()` rejects it. */
async function mountWithControlledChunk() {
  vi.resetModules();
  h.effects.length = 0;
  let release!: () => void;
  let fail!: (e: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const getSession = vi.fn(async () => ({ data: { session: null } }));
  const createClient = vi.fn(() => ({ auth: { getSession, signInWithIdToken: vi.fn() } }));
  vi.doMock("@/lib/supabase/client", async () => {
    await gate;
    return { createClient };
  });
  const { GoogleOneTap } = await import("@/components/auth/google-one-tap");
  GoogleOneTap();
  const cleanup = h.effects[0]() as () => void;
  return { release, fail, cleanup, createClient, getSession };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  envBefore = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = CLIENT_ID;
  h.nonce.mockClear();
  unhandled.mockClear();
  process.on("unhandledRejection", unhandled);
  stubBrowser();
});
afterEach(() => {
  process.off("unhandledRejection", unhandled);
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/supabase/client");
  if (envBefore === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  else process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = envBefore;
});

describe("GoogleOneTap: the client chunk arrives late", () => {
  it("still initialises Google and reaches the prompt once it does, each exactly once", async () => {
    const { release } = await mountWithControlledChunk();
    await settle();
    expect(gsi.initialize, "initialised before the chunk arrived").not.toHaveBeenCalled();
    expect(gsi.prompt).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(gsi.prompt).toHaveBeenCalledTimes(1));
    expect(gsi.initialize).toHaveBeenCalledTimes(1);
    expect((gsi.initialize.mock.calls[0][0] as { nonce: string }).nonce).toBe("hashed-nonce");
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("starts nothing the popup needs ahead of the session check while it waits: no nonce, no Google script", async () => {
    // A signed-in visitor must cost no nonce and no Google request, and the session check needs the client, so while the chunk is outstanding both stay untouched.
    const { release } = await mountWithControlledChunk();
    await settle();
    expect(h.nonce).not.toHaveBeenCalled();
    expect(scriptAppended).toBe(0);
    release();
    await vi.waitFor(() => expect(gsi.prompt).toHaveBeenCalled());
    expect(h.nonce).toHaveBeenCalledTimes(1);
    expect(scriptAppended).toBe(1);
  });

  it("an effect cleaned up while the chunk is outstanding builds no client, mints no nonce and loads no Google script when it finally arrives", async () => {
    const { release, cleanup, createClient } = await mountWithControlledChunk();
    cleanup();
    release();
    await settle();
    expect(createClient).not.toHaveBeenCalled();
    expect(h.nonce).not.toHaveBeenCalled();
    expect(scriptAppended).toBe(0);
    expect(gsi.initialize).not.toHaveBeenCalled();
    expect(gsi.prompt).not.toHaveBeenCalled();
  });
});

describe("GoogleOneTap: the client chunk fails to load", () => {
  it("is silent: nothing throws, nothing is left unhandled, and no popup is attempted", async () => {
    const { fail, createClient } = await mountWithControlledChunk();
    fail(new Error("ChunkLoadError: Loading chunk failed"));
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(h.nonce).not.toHaveBeenCalled();
    expect(scriptAppended).toBe(0);
    expect(gsi.initialize).not.toHaveBeenCalled();
    expect(gsi.prompt).not.toHaveBeenCalled();
  });

  it("is silent when it fails AFTER the effect was cleaned up too", async () => {
    const { fail, cleanup } = await mountWithControlledChunk();
    cleanup();
    fail(new Error("ChunkLoadError: Loading chunk failed"));
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(gsi.initialize).not.toHaveBeenCalled();
  });

  it("running the effect itself never throws, whichever way the chunk goes", async () => {
    vi.resetModules();
    h.effects.length = 0;
    vi.doMock("@/lib/supabase/client", () => {
      throw new Error("module failed to evaluate");
    });
    const { GoogleOneTap } = await import("@/components/auth/google-one-tap");
    GoogleOneTap();
    expect(() => h.effects[0]()).not.toThrow();
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(gsi.prompt).not.toHaveBeenCalled();
  });
});
