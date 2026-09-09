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

/**
 * send-100's job-seeded arrival view. `initialJobSeed` is the same kind of
 * documented escape hatch as `initialMessages` above — the real seed only
 * ever arrives via `onFarahJobSeed`'s window-event listener (job-seed.ts),
 * registered inside a `useEffect` that (per this file's own header) never
 * runs under `renderToStaticMarkup`. Without this prop there would be no way
 * to render the seeded branch at all in this test environment; the event
 * round trip itself still needs a real browser, same boundary as the
 * history fetch above.
 */
describe("a job seed present on arrival (initialJobSeed — the same kind of escape hatch)", () => {
  const SEED = { jobId: "job-42", jobTitle: "Backend Engineer", companyName: "Flutterwave" };

  it("renders the templated opener naming the job, not the default greeting", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialJobSeed={SEED} />);
    expect(html).toContain("Backend Engineer");
    expect(html).toContain("Flutterwave");
    expect(html).not.toContain("I can tailor your resume to any of these");
  });

  it("renders all four starters, the two chat ones before the two /tailor links", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialJobSeed={SEED} />);
    const fitIdx = html.indexOf("Why is this a good fit for me?");
    const tipsIdx = html.indexOf("What resume tips do you have for this role?");
    const tailorIdx = html.indexOf("Tailor my resume for this job");
    const introIdx = html.indexOf("Draft an intro message for this job");
    for (const idx of [fitIdx, tipsIdx, tailorIdx, introIdx]) expect(idx).toBeGreaterThan(-1);
    expect(fitIdx).toBeLessThan(tipsIdx);
    expect(tipsIdx).toBeLessThan(tailorIdx);
    expect(tailorIdx).toBeLessThan(introIdx);
  });

  it("the two link starters carry this exact job's id, one with coverLetter=1", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialJobSeed={SEED} />);
    expect(html).toContain(`/tailor?jobId=${SEED.jobId}"`);
    expect(html).toContain(`/tailor?jobId=${SEED.jobId}&amp;coverLetter=1"`);
  });

  it("does NOT replace the panel's own quick-actions block below it", () => {
    // send-100's own instruction: the seeded content renders ABOVE the
    // existing empty-state content, never in place of the generic
    // interview-prep/career-advisor/salary-negotiation quick actions.
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialJobSeed={SEED} />);
    expect(html).toContain("Job Interview Prep");
    expect(html).toContain("Career Advisor");
    expect(html).toContain("Salary Negotiation");
  });

  it("a seed present alongside real messages does not resurface — an active conversation is not interrupted", () => {
    const html = renderToStaticMarkup(
      <FarahPanel firstName="Ada" initialJobSeed={SEED} initialMessages={[OLD_TURN]} />,
    );
    expect(html).not.toContain("Backend Engineer");
    expect(html).not.toContain("Why is this a good fit for me?");
    expect(html).toContain(OLD_TURN.content);
  });
});
