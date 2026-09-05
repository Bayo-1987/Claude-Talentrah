/**
 * FarahPanel's arrival view — the part of Stage 21's follow-up this is
 * actually about.
 *
 * The panel used to prepend fetched history straight into `messages`, so
 * arriving on ANY page with the panel dropped a reader with prior Farah
 * turns into the tail of their last conversation — a fragment of an
 * unrelated answer, not the greeting and quick actions everyone else saw.
 * Fetched history is now held (`pendingHistory`) rather than shown until a
 * reader asks for it via the quiet "Continue" line.
 *
 * WHAT THIS FILE CAN AND CANNOT PIN. `useEffect` never runs under
 * `renderToStaticMarkup` (there is no DOM, and this project's vitest
 * environment is plain Node — the same reason no other stateful client
 * component here, e.g. search-combobox.tsx, has a unit test of its own). So
 * the actual fetch → hold → reveal round trip needs a real browser, verified
 * live rather than here. What IS static, and worth pinning directly, is the
 * DEFAULT initial render never showing history-shaped content on its own —
 * if a future change reintroduced the old prepend-into-`messages` behaviour,
 * it would very likely do so somewhere that also shows up in the very first
 * render this test inspects.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FarahPanel, type FarahMessage } from "@/components/app-shell/farah-panel";

const OLD_TURN: FarahMessage = {
  id: "old-1",
  role: "farah",
  content: "This is the tail end of a much older conversation.",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("the default arrival view (no initialMessages — the self-fetching path)", () => {
  it("shows the greeting, never a fetched message, on the very first render", () => {
    // useEffect hasn't run yet at this point regardless of environment — this
    // is the state a reader's very first paint is in, before any history
    // request could possibly have resolved.
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    expect(html).toContain("I can tailor your resume");
    expect(html).not.toContain(OLD_TURN.content);
  });

  it("never renders history text or a Continue line before any fetch could have resolved", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    // pendingHistory is null until the effect's fetch resolves, which cannot
    // happen inside a synchronous static render — so the offer itself must
    // be absent too, not just empty.
    expect(html).not.toContain("Continue where you left off");
  });
});

describe("an explicit initialMessages override (the documented escape hatch, e.g. for tests)", () => {
  it("shows the supplied messages immediately, bypassing the reveal gate", () => {
    // A caller that hands the panel messages directly is asking for exactly
    // these, up front — the arrival-view fix is about the SELF-FETCH path,
    // not this one, and must not quietly swallow an explicit override.
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[OLD_TURN]} />);
    expect(html).toContain(OLD_TURN.content);
    expect(html).not.toContain("Continue where you left off");
  });

  it("still shows the greeting for an explicit empty array, not a Continue offer", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[]} />);
    expect(html).toContain("I can tailor your resume");
    expect(html).not.toContain("Continue where you left off");
  });
});
