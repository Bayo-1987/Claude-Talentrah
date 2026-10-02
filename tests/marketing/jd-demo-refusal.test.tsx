/**
 * P1 — each refusal reason RENDERS its message with a way forward (a link to create a free account).
 * The client branches on `reason`, not on status (see jd-demo-input.tsx); this pins what each branch shows.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JdDemoRefusal } from "@/components/marketing/jd-demo-refusal";
import { DEMO_REFUSAL_REASONS, demoRefusalMessage } from "@/lib/demo/refusal-copy";

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();

describe("JdDemoRefusal", () => {
  it.each(DEMO_REFUSAL_REASONS)("%s: shows its own message and a link to create a free account", (reason) => {
    const html = renderToStaticMarkup(<JdDemoRefusal reason={reason} />);
    expect(text(html)).toContain(demoRefusalMessage(reason));
    expect(html).toMatch(/<a [^>]*href="\/signup"[^>]*>\s*Create a free account/);
  });

  it("announces itself politely to assistive tech, like the other demo states", () => {
    expect(renderToStaticMarkup(<JdDemoRefusal reason="already_used" />)).toContain('aria-live="polite"');
  });

  it("the server's own wording wins when it sends one (one source of truth, but the route may be ahead of a cached client)", () => {
    const html = renderToStaticMarkup(<JdDemoRefusal reason="already_used" message="Custom words from the route." />);
    expect(text(html)).toContain("Custom words from the route.");
  });
});
