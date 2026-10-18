import { INSTALL_PROMPT_KEY } from "@/lib/pwa/bootstrap";
import { FARAH_FIRST_VISIT_HINT_TEST_ID } from "@/lib/farah/first-visit-hint-id";
import { COOKIE_BANNER_TEST_ID } from "@/lib/pwa/watch-relevant-changes";

/**
 * What the install strip decides, as plain functions over a window-like object, so tests/pwa/install-state.test.ts can run them with no
 * browser. The strip component only renders what this returns.
 *
 * ONE OFFER AT MOST, and none at all when:
 *  - the app is already running standalone (matchMedia display-mode, or iOS `navigator.standalone`);
 *  - the person pressed "Not now" within the last DISMISS_DAYS (remembered in localStorage; every read and write is in try/catch, because
 *    storage throws in private windows, and a throw or a garbled value simply means "not dismissed");
 *  - the cookie banner is open, so two banners never stack on a small screen;
 *  - Farah's first-visit hint is on screen AND the viewport is a phone (under 760px): there the hint is a fixed bubble just above the Farah tab, exactly where the
 *    strip stands. From 760px up the hint sits beside the Farah panel, under the masthead, and cannot meet a bar on the bottom edge, so the strip does not wait.
 * Otherwise:
 *  - Android and other Chromium: the offer exists only once `beforeinstallprompt` was captured (src/lib/pwa/bootstrap.ts keeps it on window,
 *    possibly before this ever mounted), and Install calls `prompt()` on that kept event;
 *  - iOS Safari: there is no install event, so a hint saying how. Safari only (other iOS browsers get nothing), and iPadOS, which reports a
 *    desktop Mac user agent, is recognised by `MacIntel` plus touch points.
 */
export const DISMISS_KEY = "talentrah-install-dismissed";
export const DISMISS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallOffer = { kind: "none" } | { kind: "ios" } | { kind: "prompt"; event: BeforeInstallPromptEvent };

export interface InstallEnv {
  navigator: { userAgent: string; platform: string; maxTouchPoints: number; standalone?: boolean };
  matchMedia(query: string): { matches: boolean };
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  document: {
    documentElement: { getAttribute(name: string): string | null };
    querySelector(selector: string): unknown;
  };
}

export function isStandalone(env: InstallEnv): boolean {
  try {
    return env.matchMedia("(display-mode: standalone)").matches || env.navigator.standalone === true;
  } catch {
    return false;
  }
}

export function isIosSafari(env: InstallEnv): boolean {
  const { userAgent: ua, platform, maxTouchPoints } = env.navigator;
  const appleMobile = /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (!appleMobile) return false;
  // Chrome, Firefox, Edge and Opera on iOS identify themselves; what is left, carrying Safari's own version token, is Safari.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && /Safari\//.test(ua);
}

export function readDismissed(env: InstallEnv, now: number): boolean {
  try {
    const raw = env.localStorage?.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < DISMISS_DAYS * DAY_MS;
  } catch {
    return false;
  }
}

export function writeDismissed(env: InstallEnv, now: number): void {
  try {
    env.localStorage?.setItem(DISMISS_KEY, String(now));
  } catch {
    // Storage is blocked: the strip simply comes back next visit.
  }
}

/** Open while the cookie banner's element is in the page and the returning-visitor marker has not hidden it (see cookie-consent-banner.tsx). */
export function isCookieBannerOpen(doc: InstallEnv["document"]): boolean {
  const present = doc.querySelector(`[data-testid="${COOKIE_BANNER_TEST_ID}"]`) != null;
  return present && doc.documentElement.getAttribute("data-cookie-consent") !== "decided";
}

/** Farah's first-visit hint (src/components/app-shell/farah-first-visit-hint.tsx) is in the page. */
export function isFarahHintOpen(doc: InstallEnv["document"]): boolean {
  return doc.querySelector(`[data-testid="${FARAH_FIRST_VISIT_HINT_TEST_ID}"]`) != null;
}

/** Under 760px, the width below which the hint stands just above the Farah tab (the same breakpoint the hint and the tab use). */
export function isPhoneWidth(env: InstallEnv): boolean {
  try {
    return env.matchMedia("(max-width: 759px)").matches;
  } catch {
    return false;
  }
}

export function computeOffer(env: InstallEnv, now: number): InstallOffer {
  if (isStandalone(env)) return { kind: "none" };
  if (readDismissed(env, now)) return { kind: "none" };
  if (isCookieBannerOpen(env.document)) return { kind: "none" };
  if (isPhoneWidth(env) && isFarahHintOpen(env.document)) return { kind: "none" };
  const kept = (env as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY] as BeforeInstallPromptEvent | undefined;
  if (kept && typeof kept.prompt === "function") return { kind: "prompt", event: kept };
  if (isIosSafari(env)) return { kind: "ios" };
  return { kind: "none" };
}

/** Shows the browser's install dialog from the kept event. A prompt event can be used once, so it is forgotten afterwards either way. */
export async function runInstall(env: InstallEnv, event: BeforeInstallPromptEvent): Promise<"accepted" | "dismissed" | "error"> {
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "error";
  } finally {
    delete (env as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY];
  }
}
