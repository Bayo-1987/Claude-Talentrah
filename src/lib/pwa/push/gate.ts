/**
 * The load-time gate for push reconcile. It is the only push code in the bootstrap chunk, and it is tiny on purpose: it decides, with one synchronous read, whether the push client is even
 * worth fetching. Notification permission is "granted" only for someone who opted in, so with every flag off (nobody can opt in) the client chunk is never requested, nothing is registered
 * and nothing is sent. It never prompts: it only READS the permission.
 */
export interface ReconcileWindow {
  Notification?: { permission: string };
  requestIdleCallback?: (cb: () => void) => number;
  setTimeout: (cb: () => void, ms?: number) => unknown;
}

export function scheduleReconcile(win: ReconcileWindow, load: () => Promise<{ reconcilePush: () => Promise<void> }>): void {
  if (!win.Notification || win.Notification.permission !== "granted") return;
  const run = () => {
    load()
      .then((client) => client.reconcilePush())
      .catch(() => undefined);
  };
  if (win.requestIdleCallback) win.requestIdleCallback(run);
  else win.setTimeout(run, 2000);
}
