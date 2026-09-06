/**
 * GoogleOneTap (src/components/auth/google-one-tap.tsx) — the render-time
 * half of "must degrade completely silently."
 *
 * This suite runs under vitest's `node` environment (no DOM/jsdom in this
 * project — see vitest.config.ts and the rest of tests/ui/*.test.tsx), so it
 * can only exercise the SYNCHRONOUS render path via `renderToStaticMarkup`;
 * React never runs effects during SSR at all, in any environment, so the
 * script-loading / Google-script-blocked / prompt-declined branches inside
 * the component's `useEffect` are NOT exercised here. Those are covered
 * instead by a Playwright e2e test that blocks the real GSI script request
 * in a real browser (e2e/google-one-tap.spec.ts) and by
 * tests/auth/one-tap-client.test.ts for the sign-in-result branch. What this
 * file pins is narrower and still real: mounting the component can never
 * throw, and it never renders a single byte of markup — no placeholder box,
 * no error text, nothing that could shift layout — regardless of whether
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID is configured.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GoogleOneTap } from "@/components/auth/google-one-tap";

describe("GoogleOneTap render", () => {
  it("renders nothing — no markup, no placeholder, no possible layout shift", () => {
    const html = renderToStaticMarkup(<GoogleOneTap />);
    expect(html).toBe("");
  });

  it("does not throw when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset (integration not configured)", () => {
    const original = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    try {
      expect(() => renderToStaticMarkup(<GoogleOneTap />)).not.toThrow();
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = original;
    }
  });

  it("does not throw when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set (no window/document available server-side)", () => {
    const original = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    try {
      expect(() => renderToStaticMarkup(<GoogleOneTap />)).not.toThrow();
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      else process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = original;
    }
  });
});
