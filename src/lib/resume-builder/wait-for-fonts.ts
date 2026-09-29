/**
 * How long PrintButton will hold the export waiting for fonts before printing
 * anyway. Bounded on purpose: a font request that never resolves (offline,
 * blocked, a stalled CDN) must degrade to "print on the fallback font", never
 * to a Download PDF button that hangs forever.
 */
export const FONT_SETTLE_TIMEOUT_MS = 3000;

export type FontSettleResult = "settled" | "timed-out";

/** The slice of `document.fonts` (FontFaceSet) this module reads — narrow so it can be faked in a node-environment test. */
export interface FontFaceSetLike {
  readonly status: string;
  readonly ready: Promise<unknown>;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/**
 * Resolves once every font the page is currently using has finished loading,
 * or after `timeoutMs`, whichever comes first.
 *
 * WHY THIS EXISTS. Every next/font family here is `display: "swap"`: the page
 * paints on a fallback face immediately and swaps in the real one later. A
 * print/PDF capture that fires mid-swap can lock page breaks in from the
 * fallback layout and then reflow, stranding whole sections off the exported
 * document (reproduced in CI as `blueprint`'s trailing sections vanishing —
 * see e2e/ats-safety.spec.ts). Waiting here means a click always prints the
 * settled layout, which is the only one a reader or an ATS should receive.
 *
 * `document.fonts.ready` alone is not enough, for two reasons this handles:
 *  - it can resolve before style/layout has discovered a face that a
 *    just-rendered element needs (that face is not "loading" yet, so `ready`
 *    has nothing to wait for) — hence two animation frames first; and
 *  - a face discovered while waiting starts a new load after `ready` resolved
 *    — hence re-checking `status` and waiting again, a few times.
 *
 * It covers every family on the page at once — the app shell's font AND the
 * resume templates' own (templates/fonts.ts) and skeleton typefaces
 * (skeletons/fonts.ts) — so no family needs to be listed here, and adding a
 * new resume typeface cannot silently fall outside it.
 *
 * Never throws: an environment without the Font Loading API, or a rejection
 * from it, just means there is nothing to wait for and the caller should
 * print.
 */
export async function waitForFontsSettled({
  timeoutMs = FONT_SETTLE_TIMEOUT_MS,
  fonts = typeof document === "undefined" ? undefined : document.fonts,
  frame = nextFrame,
}: {
  timeoutMs?: number;
  fonts?: FontFaceSetLike;
  frame?: () => Promise<void>;
} = {}): Promise<FontSettleResult> {
  if (!fonts) return "settled";

  const settle = (async (): Promise<FontSettleResult> => {
    try {
      await frame();
      await frame();
      for (let attempt = 0; attempt < 3; attempt++) {
        await fonts.ready;
        if (fonts.status !== "loading") break;
      }
    } catch {
      // Nothing to wait on — fall through and let the caller print.
    }
    return "settled";
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FontSettleResult>((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });

  try {
    return await Promise.race([settle, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
