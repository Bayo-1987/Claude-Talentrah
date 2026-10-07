/**
 * GoogleOneTap's effect, run for real (src/components/auth/google-one-tap.tsx), with the browser, Google's script and the Supabase client replaced by fakes.
 *
 * This project's vitest environment is node and React never runs effects during SSR, so the component's async flow had no unit coverage (tests/ui/google-one-tap.test.tsx pins only
 * "renders nothing"). Here `useEffect` is swapped for a capture, the component function is called directly, and the captured effect is run against stubbed `window`, `document`
 * and `navigator`. The real `completeOneTapSignIn` and `oneTapSuccessDestination` are NOT mocked: what is faked is only the edges (the Supabase client, the nonce Server Action,
 * the moment-logging Server Action, Google's script).
 *
 * What it pins, and why now: the component loads the Supabase browser client by dynamic import, after the client-id check, so the auth client is not in the static chunk list of
 * every page One Tap mounts on (the landing page, /login, /signup, job and scholarship detail). The sign-in path itself must be unchanged by that: the raw nonce reaches
 * signInWithIdToken (never the hash Google gets), success navigates to the onboarding destination, a rejected exchange navigates nowhere, and every failure stays silent.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fakeSecret } from "../support/fake-secret";

const h = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  clientFactoryRuns: { n: 0 },
  createClient: vi.fn(),
}));

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useEffect: (fn: () => void | (() => void)) => void h.effects.push(fn) }));
vi.mock("@/lib/auth/one-tap-actions", () => ({ getOneTapNonceAction: vi.fn(async () => ({ nonce: "raw-nonce", hashedNonce: "hashed-nonce" })) }));
vi.mock("@/lib/auth/one-tap-events", () => ({ oneTapMomentAction: vi.fn(async () => undefined) }));
// The client module is registered per test with vi.doMock (see mountAndRun): a vi.mock factory's result is cached across vi.resetModules, so counting evaluations needs a fresh registration.

type GsiConfig = { client_id: string; nonce: string; callback: (r: { credential: string }) => void };

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
// Built at run time: a quoted literal assigned to a credential/token name would trip the Secret scan (see tests/support/fake-secret.ts).
const ID_TOKEN = fakeSecret("token");
let gsi: { initialize: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
let win: { google?: unknown; location: { search: string; pathname: string; assign: ReturnType<typeof vi.fn> } };
let scriptAppended: number;
let envBefore: string | undefined;

function stubBrowser(opts: { scriptBlocked?: boolean } = {}) {
  gsi = { initialize: vi.fn(), prompt: vi.fn(), cancel: vi.fn() };
  scriptAppended = 0;
  win = { location: { search: "", pathname: "/login", assign: vi.fn() } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { userAgent: "test-agent" });
  vi.stubGlobal("document", {
    getElementById: () => null,
    createElement: () => ({}) as Record<string, unknown>,
    head: {
      appendChild: (script: { onload?: () => void; onerror?: () => void }) => {
        scriptAppended++;
        queueMicrotask(() => {
          if (opts.scriptBlocked) return script.onerror?.();
          win.google = { accounts: { id: gsi } };
          script.onload?.();
        });
      },
    },
  });
}

async function mountAndRun(session: unknown = null, client?: Record<string, unknown>) {
  vi.resetModules();
  h.effects.length = 0;
  h.clientFactoryRuns.n = 0;
  vi.doMock("@/lib/supabase/client", () => {
    h.clientFactoryRuns.n++;
    return { createClient: h.createClient };
  });
  const signInWithIdToken = vi.fn(async () => ({ data: { session: { access_token: "t" } }, error: null }));
  const fakeClient = client ?? { auth: { getSession: vi.fn(async () => ({ data: { session } })), signInWithIdToken } };
  h.createClient.mockReset();
  h.createClient.mockReturnValue(fakeClient);
  const { GoogleOneTap } = await import("@/components/auth/google-one-tap");
  GoogleOneTap();
  expect(h.effects).toHaveLength(1);
  const factoryRunsAtMount = h.clientFactoryRuns.n;
  const cleanup = h.effects[0]();
  return { cleanup, factoryRunsAtMount, signInWithIdToken: (fakeClient as { auth: { signInWithIdToken: typeof signInWithIdToken } }).auth.signInWithIdToken, createClient: h.createClient };
}

beforeEach(() => {
  envBefore = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = CLIENT_ID;
  stubBrowser();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (envBefore === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  else process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = envBefore;
});

describe("GoogleOneTap: when the Supabase client is loaded", () => {
  it("is not loaded when the component module is imported or mounted, only once the effect is past the client-id check", async () => {
    const { factoryRunsAtMount } = await mountAndRun();
    expect(factoryRunsAtMount, "the Supabase client module was evaluated by importing the component").toBe(0);
    await vi.waitFor(() => expect(gsi.initialize).toHaveBeenCalled());
    expect(h.clientFactoryRuns.n, "the client module was loaded lazily, once").toBe(1);
  });

  it("is never loaded when no Google client id is configured (the whole feature is off)", async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const { createClient } = await mountAndRun();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.clientFactoryRuns.n).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
    expect(scriptAppended).toBe(0);
  });
});

describe("GoogleOneTap: the sign-in path is unchanged", () => {
  it("initialises Google with the HASHED nonce and, on a credential, redeems it with the RAW nonce and goes to onboarding", async () => {
    const { signInWithIdToken } = await mountAndRun();
    await vi.waitFor(() => expect(gsi.initialize).toHaveBeenCalledTimes(1));
    const config = gsi.initialize.mock.calls[0][0] as GsiConfig;
    expect(config.client_id).toBe(CLIENT_ID);
    expect(config.nonce).toBe("hashed-nonce");
    expect(gsi.prompt).toHaveBeenCalledTimes(1);

    config.callback({ credential: ID_TOKEN });
    await vi.waitFor(() => expect(win.location.assign).toHaveBeenCalledTimes(1));
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: ID_TOKEN, nonce: "raw-nonce" });
    expect(win.location.assign.mock.calls[0][0]).toMatch(/^\/onboarding/);
  });

  it("returns to the page the visitor came from (?redirectTo=) after a successful sign-in", async () => {
    win.location.search = "?redirectTo=%2Fjobs%2Fabc";
    await mountAndRun();
    await vi.waitFor(() => expect(gsi.initialize).toHaveBeenCalled());
    (gsi.initialize.mock.calls[0][0] as GsiConfig).callback({ credential: "c" });
    await vi.waitFor(() => expect(win.location.assign).toHaveBeenCalled());
    expect(win.location.assign.mock.calls[0][0]).toBe("/onboarding?next=%2Fjobs%2Fabc");
  });

  it("a rejected exchange navigates nowhere", async () => {
    const signInWithIdToken = vi.fn(async () => ({ data: { session: null }, error: { message: "nonce mismatch" } }));
    await mountAndRun(null, { auth: { getSession: async () => ({ data: { session: null } }), signInWithIdToken } });
    await vi.waitFor(() => expect(gsi.initialize).toHaveBeenCalled());
    (gsi.initialize.mock.calls[0][0] as GsiConfig).callback({ credential: "bad" });
    await vi.waitFor(() => expect(signInWithIdToken).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it("a visitor who already has a session is never prompted: no nonce, no Google script", async () => {
    const { signInWithIdToken } = await mountAndRun({ access_token: "x" });
    await new Promise((r) => setTimeout(r, 30));
    expect(gsi.initialize).not.toHaveBeenCalled();
    expect(scriptAppended).toBe(0);
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe("GoogleOneTap: every failure is silent", () => {
  it("a client that cannot be built does nothing and does not throw", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { createClient } = await mountAndRun();
      createClient.mockImplementation(() => {
        throw new Error("missing supabase url");
      });
      // The effect was already started with the working client above; start a fresh one with the throwing one.
      h.effects.length = 0;
      const { GoogleOneTap } = await import("@/components/auth/google-one-tap");
      GoogleOneTap();
      gsi.initialize.mockClear();
      h.effects[0]();
      await new Promise((r) => setTimeout(r, 30));
      expect(gsi.initialize).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a blocked Google script does nothing visible and does not throw", async () => {
    stubBrowser({ scriptBlocked: true });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await mountAndRun();
      await new Promise((r) => setTimeout(r, 30));
      expect(gsi.initialize).not.toHaveBeenCalled();
      expect(win.location.assign).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("an effect cleaned up before the client chunk arrives builds no client and loads no Google script", async () => {
    const { cleanup, createClient } = await mountAndRun();
    (cleanup as () => void)();
    await new Promise((r) => setTimeout(r, 30));
    expect(createClient).not.toHaveBeenCalled();
    expect(scriptAppended).toBe(0);
    expect(gsi.initialize).not.toHaveBeenCalled();
  });

  it("cleanup cancels Google's prompt, and a callback that fires after cleanup does nothing", async () => {
    const { cleanup, signInWithIdToken } = await mountAndRun();
    await vi.waitFor(() => expect(gsi.initialize).toHaveBeenCalled());
    (cleanup as () => void)();
    expect(gsi.cancel).toHaveBeenCalledTimes(1);
    (gsi.initialize.mock.calls[0][0] as GsiConfig).callback({ credential: "late" });
    await new Promise((r) => setTimeout(r, 20));
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
  });
});
