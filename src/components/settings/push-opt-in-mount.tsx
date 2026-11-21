"use client";

import { setNotificationPreferenceAction } from "@/app/(app)/settings/notification-actions";
import { PUSH_ENABLED_EVENT, PushOptIn, type LoadPushClient } from "./push-opt-in";

/**
 * Where the page-side push client is handed to the opt-in button. Next does not let a server component pass a function to a client component, so the loader lives in this client file.
 *
 * The loader is U3b's page-side push client, loaded on demand. tsc checks that the real module satisfies the `PushClient` interface the button is typed by.
 *
 * After a tap turns push on for this device, the account switch is saved too (push_enabled = true) and the page is told, so the toggle and the device agree. A failed save is ignored: the device is subscribed
 * either way, and the toggle can still be switched by hand.
 */
const loadPushClient: LoadPushClient = () => import("@/lib/pwa/push/client");

function recordEnabled() {
  void setNotificationPreferenceAction("push_enabled", true)
    .then((result) => {
      if (result.ok) window.dispatchEvent(new CustomEvent(PUSH_ENABLED_EVENT));
    })
    .catch(() => undefined);
}

export function PushOptInMount({ enabled }: { enabled: boolean }) {
  return <PushOptIn enabled={enabled} loadClient={loadPushClient} onEnabled={recordEnabled} />;
}
