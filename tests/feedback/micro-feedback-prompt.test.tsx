/**
 * `MicroFeedbackPrompt` (src/components/feedback/micro-feedback-prompt.tsx)
 * — the initial-render shape only, per this repo's own established split
 * (see `tests/employer/job-share-button.test.tsx`'s own header): a Vitest
 * static-markup test pins what renders before any click, and the actual
 * state transition after a click is real interactivity, verified live in
 * the browser for this feature (see send report) rather than simulated
 * here — this repo has no DOM-interaction test library, and every existing
 * client component test draws that same line.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MicroFeedbackPrompt } from "@/components/feedback/micro-feedback-prompt";

function render(pagePath: string) {
  return renderToStaticMarkup(
    <MicroFeedbackPrompt context="tailoring_result" prompt="Was this tailored resume useful?" pagePath={pagePath} />,
  );
}

describe("MicroFeedbackPrompt — initial render", () => {
  it("renders the exact prompt text passed in", () => {
    const html = render("/tailor");
    expect(html).toContain("Was this tailored resume useful?");
  });

  it("renders both reaction actions, and nothing from the reacted states yet", () => {
    const html = render("/tailor");
    expect(html).toContain("Yes, this helped");
    expect(html).toContain("Not quite");
    expect(html).not.toContain("Thanks — noted.");
    expect(html).not.toContain("Tell us what was off");
    expect(html).not.toContain("/feedback?from=");
  });

  it("never renders a star rating, a numeric scale, or any progress/gamification meter", () => {
    // CLAUDE.md's anti-gamification rule is explicit and hard — a binary
    // reaction is the whole surface this component may ever have.
    const html = render("/tailor");
    expect(html).not.toMatch(/★|☆|\d\s*\/\s*5|progress/i);
  });
});
