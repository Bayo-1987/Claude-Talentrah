/**
 * The push-capable worker's version. ONE constant, imported by the worker source (src/lib/pwa/service-worker-source.ts, which answers it to the page) and by the page client
 * (src/lib/pwa/push/client.ts, which compares against it), so the two cannot disagree. Bump it when the worker's push behaviour changes in a way the page must wait for.
 */
export const PUSH_WORKER_VERSION = "push-1";

/** The message the page sends, with a MessageChannel port, to ask the active worker for its version. */
export const WORKER_VERSION_REQUEST = "talentrah-worker-version";
