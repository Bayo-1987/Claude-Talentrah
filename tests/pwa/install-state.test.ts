/**
 * What the install strip decides, with no browser: which offer (if any) a given device and state gets (src/lib/pwa/install-state.ts).
 * The strip itself in a real browser is e2e/pwa-install-strip.spec.ts.
 */
import { describe, expect, it } from "vitest";
import {
  DISMISS_DAYS,
  DISMISS_KEY,
  computeOffer,
  isCookieBannerOpen,
  isIosSafari,
  isStandalone,
  readDismissed,
  runInstall,
  writeDismissed,
  type InstallEnv,
} from "@/lib/pwa/install-state";
import { INSTALL_PROMPT_KEY } from "@/lib/pwa/bootstrap";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15";
const IPAD_SAFARI_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const MAC_SAFARI = IPAD_SAFARI_DESKTOP_UA;
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

interface EnvOpts {
  ua?: string;
  platform?: string;
  maxTouchPoints?: number;
  standaloneMedia?: boolean;
  navStandalone?: boolean | undefined;
  storage?: "ok" | "throws-on-read" | "throws-on-write" | "missing";
  bannerElement?: boolean;
  decidedAttr?: boolean;
  keptPrompt?: unknown;
  now?: number;
}

function env(o: EnvOpts = {}) {
  const store = new Map<string, string>();
  const mode = o.storage ?? "ok";
  const localStorage =
    mode === "missing"
      ? undefined
      : {
          getItem: (k: string) => {
            if (mode === "throws-on-read") throw new Error("SecurityError");
            return store.get(k) ?? null;
          },
          setItem: (k: string, v: string) => {
            if (mode === "throws-on-write") throw new Error("QuotaExceededError");
            store.set(k, v);
          },
        };
  const e = {
    navigator: { userAgent: o.ua ?? ANDROID_CHROME, platform: o.platform ?? "Linux armv8l", maxTouchPoints: o.maxTouchPoints ?? 5, standalone: o.navStandalone },
    matchMedia: (q: string) => ({ matches: q === "(display-mode: standalone)" ? (o.standaloneMedia ?? false) : false }),
    localStorage,
    document: {
      documentElement: { getAttribute: (n: string) => (n === "data-cookie-consent" && o.decidedAttr ? "decided" : null) },
      querySelector: (s: string) => (s === '[data-testid="cookie-consent-banner"]' && o.bannerElement ? {} : null),
    },
    [INSTALL_PROMPT_KEY]: o.keptPrompt,
  } as unknown as InstallEnv;
  return { env: e, store, now: o.now ?? 1_700_000_000_000 };
}

const fakePrompt = () => {
  const calls = { prompt: 0 };
  return { calls, event: { prompt: async () => void calls.prompt++, userChoice: Promise.resolve({ outcome: "accepted" as const }) } };
};

describe("standalone: already installed", () => {
  it("is detected from the display-mode media query", () => {
    expect(isStandalone(env({ standaloneMedia: true }).env)).toBe(true);
  });
  it("is detected from iOS navigator.standalone", () => {
    expect(isStandalone(env({ navStandalone: true }).env)).toBe(true);
  });
  it("is false in a normal tab", () => {
    expect(isStandalone(env().env)).toBe(false);
  });
  it("hides every offer, even with a kept prompt and on iOS Safari", () => {
    const p = fakePrompt();
    expect(computeOffer(env({ standaloneMedia: true, keptPrompt: p.event }).env, 0).kind).toBe("none");
    expect(computeOffer(env({ navStandalone: true, ua: IPHONE_SAFARI }).env, 0).kind).toBe("none");
  });
});

describe("iOS Safari gets the hint, nobody else does", () => {
  it.each([
    ["iPhone Safari", IPHONE_SAFARI, "iPhone", 5, true],
    ["iPad Safari reporting a desktop UA (iPadOS)", IPAD_SAFARI_DESKTOP_UA, "MacIntel", 5, true],
    ["iPhone Chrome", IPHONE_CHROME, "iPhone", 5, false],
    ["iPhone Firefox", IPHONE_FIREFOX, "iPhone", 5, false],
    ["Mac Safari (no touch)", MAC_SAFARI, "MacIntel", 0, false],
    ["Android Chrome", ANDROID_CHROME, "Linux armv8l", 5, false],
  ])("%s", (_l, ua, platform, touch, expected) => {
    expect(isIosSafari(env({ ua, platform, maxTouchPoints: touch }).env)).toBe(expected);
  });

  it("offers the ios hint on iPhone Safari with nothing else needed", () => {
    expect(computeOffer(env({ ua: IPHONE_SAFARI, platform: "iPhone" }).env, 0).kind).toBe("ios");
  });

  it("offers nothing on Android until the prompt arrives", () => {
    expect(computeOffer(env().env, 0).kind).toBe("none");
  });
});

describe("the Android/Chromium offer", () => {
  it("appears when the prompt was captured BEFORE the strip mounted (it is read from window on mount)", () => {
    const p = fakePrompt();
    const offer = computeOffer(env({ keptPrompt: p.event }).env, 0);
    expect(offer.kind).toBe("prompt");
    if (offer.kind === "prompt") expect(offer.event).toBe(p.event);
  });

  it("calls prompt() once on the kept event when Install is pressed, then forgets the event", async () => {
    const p = fakePrompt();
    const { env: e } = env({ keptPrompt: p.event });
    const outcome = await runInstall(e, p.event as never);
    expect(p.calls.prompt).toBe(1);
    expect(outcome).toBe("accepted");
    expect((e as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY]).toBeUndefined();
  });

  it("a prompt() that rejects does not throw", async () => {
    const e = env().env;
    const bad = { prompt: async () => { throw new Error("InvalidStateError"); }, userChoice: Promise.resolve({ outcome: "dismissed" as const }) };
    await expect(runInstall(e, bad as never)).resolves.toBe("error");
  });
});

describe("dismissal is remembered for a fixed period, and storage is never trusted", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("hides the offer after Not now, until the period ends", () => {
    const p = fakePrompt();
    const { env: e, now } = env({ keptPrompt: p.event });
    writeDismissed(e, now);
    expect(readDismissed(e, now + 1)).toBe(true);
    expect(computeOffer(e, now + 1).kind).toBe("none");
    expect(readDismissed(e, now + (DISMISS_DAYS - 1) * DAY)).toBe(true);
    expect(computeOffer(e, now + (DISMISS_DAYS + 1) * DAY).kind).toBe("prompt");
  });

  it("stores a timestamp under one named key", () => {
    const { env: e, store, now } = env();
    writeDismissed(e, now);
    expect(DISMISS_KEY).toBe("talentrah-install-dismissed");
    expect(store.get(DISMISS_KEY)).toBe(String(now));
  });

  it("ignores a garbled stored value", () => {
    const { env: e, store, now } = env({ keptPrompt: fakePrompt().event });
    store.set(DISMISS_KEY, "not a number");
    expect(readDismissed(e, now)).toBe(false);
    expect(computeOffer(e, now).kind).toBe("prompt");
  });

  it("when storage throws on read it still offers (treated as never dismissed)", () => {
    const { env: e, now } = env({ storage: "throws-on-read", keptPrompt: fakePrompt().event });
    expect(() => readDismissed(e, now)).not.toThrow();
    expect(computeOffer(e, now).kind).toBe("prompt");
  });

  it("when storage throws on write, dismissing does not throw", () => {
    const { env: e, now } = env({ storage: "throws-on-write" });
    expect(() => writeDismissed(e, now)).not.toThrow();
  });

  it("when localStorage does not exist at all, nothing throws", () => {
    const { env: e, now } = env({ storage: "missing", keptPrompt: fakePrompt().event });
    expect(() => writeDismissed(e, now)).not.toThrow();
    expect(computeOffer(e, now).kind).toBe("prompt");
  });
});

describe("never under the cookie banner", () => {
  it("is open while its element is in the page and the visitor has not decided", () => {
    expect(isCookieBannerOpen(env({ bannerElement: true }).env.document)).toBe(true);
  });
  it("is closed once the element is gone (a choice was made in this tab)", () => {
    expect(isCookieBannerOpen(env({ bannerElement: false }).env.document)).toBe(false);
  });
  it("is closed for a returning visitor: the element is still there but <html data-cookie-consent='decided'> hides it", () => {
    expect(isCookieBannerOpen(env({ bannerElement: true, decidedAttr: true }).env.document)).toBe(false);
  });
  it("hides every offer while it is open, and offers again after", () => {
    const p = fakePrompt();
    expect(computeOffer(env({ bannerElement: true, keptPrompt: p.event }).env, 0).kind).toBe("none");
    expect(computeOffer(env({ bannerElement: true, ua: IPHONE_SAFARI, platform: "iPhone" }).env, 0).kind).toBe("none");
    expect(computeOffer(env({ bannerElement: false, keptPrompt: p.event }).env, 0).kind).toBe("prompt");
  });
});
