"use client";

import { PushOptIn, type LoadPushClient } from "./push-opt-in";

/**
 * Where the page-side push client is handed to the opt-in button. Next does not let a server component pass a function to a client component, so the loader lives in this client file.
 *
 * The loader is U3b's page-side push client, loaded on demand. tsc checks that the real module satisfies the `PushClient` interface the button is typed by.
 */
const loadPushClient: LoadPushClient = () => import("@/lib/pwa/push/client");

export function PushOptInMount({ enabled }: { enabled: boolean }) {
  return <PushOptIn enabled={enabled} loadClient={loadPushClient} />;
}
