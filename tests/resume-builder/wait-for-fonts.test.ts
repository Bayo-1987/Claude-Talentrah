/**
 * The gate behind PrintButton's "Download PDF" (send-473). What it must
 * guarantee, each a distinct way an export silently loses content:
 *
 *  1. It does NOT resolve while a font is still loading — resolving early is
 *     the original bug (print fires mid-`font-display: swap`, page breaks
 *     lock in from the fallback layout, sections vanish from the PDF).
 *  2. It asks for two animation frames BEFORE consulting `fonts.ready` —
 *     `ready` resolves immediately for a face layout hasn't discovered yet.
 *  3. It re-checks `status` after `ready` — a face discovered while waiting
 *     starts a fresh load that the first `ready` did not cover.
 *  4. It is BOUNDED — a font request that never resolves must fall back to
 *     printing, never hang the button.
 *  5. It never throws and never leaks its timer.
 *
 * The real-browser proof that PrintButton actually calls it, in the right
 * order, on a throttled font load is e2e/print-button-fonts.spec.ts — this
 * repo's vitest runs in `environment: "node"` (no DOM, no component
 * interaction), so this file pins the logic and that spec pins the wiring.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FONT_SETTLE_TIMEOUT_MS,
  waitForFontsSettled,
  type FontFaceSetLike,
} from "@/lib/resume-builder/wait-for-fonts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const immediateFrame = () => Promise.resolve();

/** Flush pending microtasks so an assertion can observe "still waiting". */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForFontsSettled", () => {
  it("settles immediately when the Font Loading API is unavailable", async () => {
    await expect(waitForFontsSettled({ fonts: undefined, frame: immediateFrame })).resolves.toBe("settled");
  });

  it("does not resolve while a font is still loading, and resolves once it lands", async () => {
    const font = deferred();
    const fonts: FontFaceSetLike = { status: "loading", ready: font.promise };

    let result: string | undefined;
    const pending = waitForFontsSettled({ fonts, frame: immediateFrame }).then((r) => (result = r));

    await flush();
    expect(result, "resolved while a font was still loading — this is the export race").toBeUndefined();

    (fonts as { status: string }).status = "loaded";
    font.resolve();
    await pending;
    expect(result).toBe("settled");
  });

  it("waits two animation frames before it even looks at fonts.ready", async () => {
    const events: string[] = [];
    const fonts: FontFaceSetLike = {
      status: "loaded",
      get ready() {
        events.push("ready");
        return Promise.resolve();
      },
    };
    const frame = () => {
      events.push("frame");
      return Promise.resolve();
    };

    await waitForFontsSettled({ fonts, frame });
    expect(events.slice(0, 3)).toEqual(["frame", "frame", "ready"]);
  });

  it("waits again when a face started loading while it was waiting", async () => {
    const first = deferred();
    const second = deferred();
    let reads = 0;
    const fonts = {
      status: "loading",
      get ready() {
        reads += 1;
        return reads === 1 ? first.promise : second.promise;
      },
    };

    let result: string | undefined;
    const pending = waitForFontsSettled({ fonts, frame: immediateFrame }).then((r) => (result = r));

    // First `ready` resolves, but a newly discovered face is still loading.
    first.resolve();
    await flush();
    expect(result, "trusted the first ready even though status was still 'loading'").toBeUndefined();
    expect(reads).toBe(2);

    fonts.status = "loaded";
    second.resolve();
    await pending;
    expect(result).toBe("settled");
  });

  it("gives up after the timeout and reports it, instead of hanging", async () => {
    vi.useFakeTimers();
    const fonts: FontFaceSetLike = { status: "loading", ready: new Promise(() => {}) };

    const pending = waitForFontsSettled({ fonts, frame: immediateFrame });
    await vi.advanceTimersByTimeAsync(FONT_SETTLE_TIMEOUT_MS - 1);
    let result: string | undefined;
    void pending.then((r) => (result = r));
    await flush();
    expect(result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("timed-out");
  });

  it("honours a custom timeout", async () => {
    vi.useFakeTimers();
    const fonts: FontFaceSetLike = { status: "loading", ready: new Promise(() => {}) };
    const pending = waitForFontsSettled({ fonts, frame: immediateFrame, timeoutMs: 250 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe("timed-out");
  });

  it("clears its timer once settled — a click must not leave a 3s timeout behind", async () => {
    vi.useFakeTimers();
    const fonts: FontFaceSetLike = { status: "loaded", ready: Promise.resolve() };
    await expect(waitForFontsSettled({ fonts, frame: immediateFrame })).resolves.toBe("settled");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never throws: a rejecting fonts.ready still lets the caller print", async () => {
    const fonts: FontFaceSetLike = { status: "loading", ready: Promise.reject(new Error("font API broke")) };
    await expect(waitForFontsSettled({ fonts, frame: immediateFrame })).resolves.toBe("settled");
  });
});
