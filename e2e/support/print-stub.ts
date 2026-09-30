import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __printCalls: Array<{ fontsStatus: string; loadingFaces: number }>;
    __capturePdfNow: () => Promise<void>;
  }
}

/**
 * Replaces `window.print` with a stub that, at the exact moment the app calls
 * it, (1) records the document's font state and (2) asks Node to run
 * `onPrint` — typically `page.pdf()`, Chromium's own print-to-PDF pipeline,
 * the same one `window.print()` feeds. So an assertion on what it captured is
 * an assertion on what a real click would have printed, not on a page that
 * has long since settled. Shared by e2e/print-button-fonts.spec.ts and
 * e2e/employer-print-fonts.spec.ts.
 */
export async function installPrintStub(page: Page, onPrint: () => Promise<void>) {
  await page.exposeFunction("__capturePdfNow", onPrint);
  await page.addInitScript(() => {
    window.__printCalls = [];
    window.print = () => {
      window.__printCalls.push({
        fontsStatus: document.fonts.status,
        loadingFaces: [...document.fonts].filter((f) => f.status === "loading").length,
      });
      void window.__capturePdfNow();
    };
  });
}
