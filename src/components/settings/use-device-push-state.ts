"use client";

import { useEffect, useState } from "react";
import type { PushState } from "@/lib/pwa/push/client";

/**
 * Where push stands on THIS device, or null until it is known. It asks the page-side client for its state only (never a permission prompt, never a subscription), loads that client on demand, and
 * stays null when `enabled` is false or the client fails to load.
 */
export function useDevicePushState(enabled: boolean): PushState | null {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    import("@/lib/pwa/push/client")
      .then((client) => client.getPushState())
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}
