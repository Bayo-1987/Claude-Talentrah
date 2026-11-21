"use client";

import { useEffect, useRef, useState } from "react";
import { STALE_WORKER_TEXT } from "@/lib/pwa/push/client";

/**
 * The button that turns push notifications on for this device (U6).
 *
 * THE SEAM. The subscribing itself (permission, worker, subscription, the server round trip) is the page-side client from U3b (src/lib/pwa/push/client.ts). This branch is stacked on a base that does not
 * contain it, so the component takes it as a LOADER (`loadClient`) and types it by the interface U3b exposes. Assembly adds the one line, in a client file:
 *   loadClient={() => import("@/lib/pwa/push/client")}
 * and `tsc` then proves the real module satisfies `PushClient`. Nothing here asks for permission, touches a worker or subscribes; the component calls the client's functions and shows the answer.
 *
 * LOAD NEVER PROMPTS. On load the component asks the client for its STATE only. The permission prompt appears only after a tap on the button, and never again once the browser says blocked.
 */
export type PushState = "unsupported" | "needs_install" | "blocked" | "stale_worker" | "off" | "on";
export type EnableFailure = "unsupported" | "needs_install" | "blocked" | "dismissed" | "stale_worker" | "refused" | "signed_out" | "error";
export type EnableResult = { ok: true } | { ok: false; reason: EnableFailure };

/** Exactly the functions of U3b's client that the preferences screen can see. */
export interface PushClient {
  getPushState(): Promise<PushState>;
  enablePush(): Promise<EnableResult>;
  reconcilePush(): Promise<void>;
  deviceTimezone(): string | null;
}
export type LoadPushClient = () => Promise<PushClient>;

export interface PushOptInProps {
  /** The push sender flag, read on the server. Off: nothing renders, nothing loads. */
  enabled: boolean;
  /** Loads U3b's client. Absent: nothing renders, nothing loads. */
  loadClient?: LoadPushClient;
  /** Called once after a tap that turned push on for this device. */
  onEnabled?: () => void;
}

/** Fired on the window after a tap turned push on for this device, so the screen can show the account switch on. */
export const PUSH_ENABLED_EVENT = "talentrah:push-enabled";

export type OptInState = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; push: PushState; message: string | null };

/** A tap counts as an opt-in only when the result is a ready state with push on. */
export function enabledTransition(next: OptInState): boolean {
  return next.phase === "ready" && next.push === "on";
}

export function shouldStartOptIn(props: PushOptInProps): boolean {
  return props.enabled === true && typeof props.loadClient === "function";
}

const FAILURE_MESSAGES: Record<EnableFailure, string | null> = {
  unsupported: null,
  needs_install: null,
  blocked: null,
  stale_worker: null,
  dismissed: "You closed the permission prompt, so nothing changed. You can try again whenever you like.",
  refused: "Your browser would not turn notifications on. Try again in a moment.",
  signed_out: "Sign in again to turn on notifications.",
  error: "That did not work. Try again in a moment.",
};

export function createOptInController(load: LoadPushClient) {
  let client: PushClient | null = null;
  let inFlight: Promise<OptInState> | null = null;
  let current: OptInState = { phase: "loading" };

  async function init(): Promise<OptInState> {
    try {
      client = await load();
      const push = await client.getPushState();
      current = { phase: "ready", push, message: null };
    } catch {
      current = { phase: "failed" };
    }
    return current;
  }

  async function click(): Promise<OptInState> {
    if (inFlight) return inFlight;
    if (!client || current.phase !== "ready" || current.push !== "off") return current;
    const c = client;
    inFlight = (async (): Promise<OptInState> => {
      try {
        const result = await c.enablePush();
        if (result.ok) current = { phase: "ready", push: "on", message: null };
        else {
          const reason = result.reason;
          const state: PushState = reason === "blocked" || reason === "needs_install" || reason === "unsupported" || reason === "stale_worker" ? reason : "off";
          current = { phase: "ready", push: state, message: FAILURE_MESSAGES[reason] };
        }
      } catch {
        current = { phase: "ready", push: "off", message: FAILURE_MESSAGES.error };
      }
      return current;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return { init, click };
}

export function PushOptInView({ state, busy, onEnable }: { state: OptInState; busy: boolean; onEnable: () => void }) {
  if (state.phase !== "ready") return null;
  const { push, message } = state;
  return (
    <div className="flex flex-col gap-2 font-body text-[13px] text-ink-soft">
      {push === "off" && (
        <button
          type="button"
          onClick={onEnable}
          disabled={busy}
          className="inline-flex min-h-[44px] w-fit items-center border-[1.5px] border-ink bg-ink px-4 font-body text-[14px] font-semibold text-paper hover:bg-rust disabled:opacity-50"
        >
          Turn on notifications
        </button>
      )}
      {push === "on" && <p className="text-ink">Notifications are on for this device.</p>}
      {push === "blocked" && <p>Notifications are blocked for Talentrah in this browser. To turn them on, allow notifications for this site in your browser or phone settings, then come back here.</p>}
      {push === "needs_install" && <p>To get notifications on an iPhone or iPad, first add Talentrah to your Home Screen (Share, then Add to Home Screen), open it from there, and come back to this page.</p>}
      {push === "unsupported" && <p>This browser can&rsquo;t show notifications from Talentrah.</p>}
      {push === "stale_worker" && <p>{STALE_WORKER_TEXT}.</p>}
      {message && (
        <p role="status" className="font-display italic">
          {message}
        </p>
      )}
    </div>
  );
}

export function PushOptIn(props: PushOptInProps) {
  const start = shouldStartOptIn(props);
  const { loadClient } = props;
  const controller = useRef<ReturnType<typeof createOptInController> | null>(null);
  const [state, setState] = useState<OptInState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!start || !loadClient) return;
    let live = true;
    controller.current = createOptInController(loadClient);
    void controller.current.init().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [start, loadClient]);

  if (!start) return null;
  return (
    <PushOptInView
      state={state}
      busy={busy}
      onEnable={() => {
        const ctl = controller.current;
        if (!ctl) return;
        setBusy(true);
        void ctl.click().then((next) => {
          setState(next);
          setBusy(false);
          if (enabledTransition(next)) props.onEnabled?.();
        });
      }}
    />
  );
}
