/**
 * The lazy install strip must not make React throw away the server HTML around it.
 *
 * `next/dynamic(..., { ssr: false })` makes the SERVER bail out to client rendering at the nearest Suspense boundary: the HTML for that whole boundary is
 * discarded and re-rendered in the browser. The strip sits in the signed-in shell, whose nearest boundary is the page's own, so every signed-in page lost its
 * server-rendered content and became interactive late: e2e/credit-prices.spec.ts clicked "More concise" before the page had hydrated and timed out waiting for
 * the preview (28 of 28 passed with the strip removed, 4 of 28 failed with it). The wrapper now renders nothing on the server and imports the strip after mount.
 */
import { describe, expect, it } from "vitest";
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { InstallStripLazy } from "@/components/pwa/install-strip-lazy";

describe("InstallStripLazy on the server", () => {
  const html = renderToString(
    <Suspense fallback={<p>fallback</p>}>
      <main>
        <p>server rendered page content</p>
        <InstallStripLazy />
      </main>
    </Suspense>,
  );

  it("does not bail out to client rendering (React marks that boundary with <!--$!-->)", () => {
    expect(html).not.toContain("<!--$!-->");
    expect(html).not.toContain("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  });

  it("keeps the server-rendered content and never shows the Suspense fallback", () => {
    expect(html).toContain("server rendered page content");
    expect(html).not.toContain("fallback");
  });

  it("renders nothing of its own", () => {
    expect(html).not.toContain("install-strip");
  });
});

describe("InstallStripLazy source", () => {
  // The render test above cannot see the bail-out (Vitest loads next/dynamic's pages-router build, which renders null; the app router's build throws on the
  // server), so the cause is guarded in the source too, and the real behaviour in e2e/pwa-install-strip.spec.ts against a production build.
  it("does not use next/dynamic", () => {
    // Comments removed first: the file explains the very thing it must not do.
    const src = readFileSync(path.resolve(__dirname, "../../src/components/pwa/install-strip-lazy.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/from\s+["']next\/dynamic["']/);
    expect(src).not.toMatch(/\bdynamic\s*\(/);
  });
});
