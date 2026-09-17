"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  captureMicroFeedbackReactionAction,
  type MicroFeedbackContext,
} from "@/lib/analytics/actions";

type State = "idle" | "positive" | "needs_work";

/**
 * A quiet pulse-check, not PostHog's own Surveys widget (client-side only,
 * a floating branded popup) and not a star rating — both rejected on the
 * same reasoning: this app ships server-side-only analytics on purpose
 * (low-end-Android/expensive-data NFR), and a boxed corner bubble is close
 * to the exact thing the Editorial design system's own rules exist to
 * reject (no drop shadows except the hero input, no gamification chrome).
 *
 * Two moments only, both places nothing currently asks the user anything:
 * right after a tailoring result renders, and right after an Auto-Apply
 * confirmation succeeds. Deliberately NOT reused after a mentor session —
 * `review-form.tsx` already asks a "how was that" question there, about a
 * different thing (mentor quality, public), and a second prompt right next
 * to it would be redundant, not additive.
 *
 * Local state only — no cross-session suppression tracking in this pass.
 * Once reacted, this stays in its end state for the render it's on; it
 * never reappears for the same result and there is no auto-dismiss timer.
 */
export function MicroFeedbackPrompt({
  context,
  prompt,
  pagePath,
}: {
  context: MicroFeedbackContext;
  prompt: string;
  pagePath: string;
}) {
  const [state, setState] = useState<State>("idle");

  function react(reaction: "positive" | "needs_work") {
    setState(reaction);
    // Fire-and-forget: captureEvent itself never throws, and there is
    // nothing useful to show the user if this fails.
    void captureMicroFeedbackReactionAction(context, reaction);
  }

  if (state === "positive") {
    return (
      <div className="border-t border-line pt-3">
        <p className="font-body text-[13px] text-ink-soft">Thanks — noted.</p>
      </div>
    );
  }

  if (state === "needs_work") {
    return (
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <p className="font-body text-[13px] text-ink-soft">Thanks — noted.</p>
        <Link
          href={`/feedback?from=${encodeURIComponent(pagePath)}`}
          className="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
        >
          Tell us what was off
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
      <p className="font-body text-[13px] text-ink-soft">{prompt}</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => react("positive")}>
          Yes, this helped
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => react("needs_work")}>
          Not quite
        </Button>
      </div>
    </div>
  );
}
