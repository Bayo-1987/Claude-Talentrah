import { CACHE_PREFIX } from "@/lib/pwa/service-worker-source";

/**
 * The early, tiny client bootstrap the root layout renders on every page. Three jobs, in this order of care:
 *
 *  1. NEVER run where it must not: inside a frame (`self !== top`) or on /embed/*, it returns before doing anything. No registration, no
 *     listener, no unregister. The embed route is its own standalone HTML today and the layout does not render there; this is defence in depth.
 *  2. Kill switch (`enabled === false`): ONLY unregister what exists and delete this app's caches. NEVER call register. A page that kept
 *     registering would reinstall the self-destruct worker on every load, which is the reload loop an earlier design had.
 *  3. Enabled: capture `beforeinstallprompt` immediately, and register /sw.js after `load` and idle time so it cannot touch LCP.
 *
 * The prompt is captured HERE, not in the lazy install strip, because the browser can fire it before that component has mounted. The event is
 * kept on `window` under one named property and announced with a custom event; the strip reads the property on mount and listens for the event.
 *
 * SIDE EFFECT, DELIBERATE: `preventDefault()` on `beforeinstallprompt` runs on every page, so Chrome's own mini-infobar never shows. The
 * browser-menu "Install" still works. Our install strip (signed-in app shell only) is the only prompt. docs/pwa.md says this too.
 *
 * Takes the window as a parameter so tests/pwa/bootstrap.test.ts can drive it with a fake. Registration sets no cookie.
 */
export const INSTALL_PROMPT_KEY = "__talentrahInstallPrompt";
export const INSTALL_PROMPT_EVENT = "talentrah:installprompt";

export type PwaWindow = Pick<Window, "location" | "document" | "navigator" | "addEventListener" | "dispatchEvent"> & {
  self: unknown;
  top: unknown;
  caches?: Pick<CacheStorage, "keys" | "delete">;
  requestIdleCallback?: (cb: () => void) => number;
  setTimeout: (cb: () => void, ms?: number) => unknown;
};

export function startPwa(win: PwaWindow, enabled: boolean): void {
  if (win.self !== win.top) return;
  if (win.location.pathname.startsWith("/embed/")) return;
  const sw = win.navigator.serviceWorker;
  if (!sw) return;

  if (!enabled) {
    sw.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))).catch(() => undefined);
    win.caches
      ?.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => win.caches!.delete(n))))
      .catch(() => undefined);
    return;
  }

  win.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    (win as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY] = e;
    win.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  });

  const register = () => {
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  };
  const idle = () => (win.requestIdleCallback ? win.requestIdleCallback(register) : win.setTimeout(register, 1));
  if (win.document.readyState === "complete") idle();
  else win.addEventListener("load", idle, { once: true });
}
