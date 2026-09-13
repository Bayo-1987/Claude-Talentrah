"use client";

import { seedFarahForJob } from "@/lib/farah/job-seed";
import { scrollToFarahPanel } from "@/lib/farah/scroll-to-panel";

/**
 * "Ask Farah" for ONE posting (send-100) — a single button, no dropdown.
 *
 * WHAT THIS REPLACED. Until send-100, this was a disclosure menu grouped
 * Vet → Land: "Am I a fit?" / "Gap analysis" read `match_scores.explanation`
 * and rendered static prose inline; "Tailor my resume" / "Draft intro
 * message" linked to /tailor. That existed because there was no way for a
 * card to seed Farah's docked panel — this component's own header said so
 * explicitly, and named a real job-seeded conversation as "a legitimate
 * future feature with its own credit-cost question."
 *
 * That question now has an answer (send-97's gate), so all four of those
 * destinations are reachable from the seeded panel this button opens
 * (src/lib/farah/job-seed.ts, src/components/app-shell/farah-panel.tsx):
 * the two Vet questions become real, job-grounded chat turns instead of
 * static re-renders of data already on the card; the two Land links are
 * exactly the same /tailor hrefs, just rendered in the panel instead of a
 * card-anchored dropdown. With every item the menu held reachable elsewhere,
 * a toggle-and-dropdown around a single remaining click was structure with
 * nothing left to organise — collapsed to one button, matching how jobright
 * puts one direct "Ask Orion" button on the card rather than hiding it
 * behind a menu, which is the same discoverability point raised when this
 * menu was first discussed.
 *
 * THE NAME "ASK FARAH" IS BACK ON PURPOSE. The menu's own prior fix
 * (2026-09-08) renamed this trigger away from "Ask Farah" specifically
 * because it promised a conversation the static dropdown never delivered,
 * colliding with the masthead's and the mobile tab's own "Ask Farah" button,
 * which opens the real docked chat. That collision is gone now for the
 * opposite reason it was created: this button genuinely does open the real
 * docked chat, seeded for this job, so the name finally describes what
 * clicking it does.
 *
 * WHY A WINDOW EVENT AND A SCROLL CALL, NOT PROPS OR STATE. See job-seed.ts's
 * own header — the docked panel is a sibling several component trees away,
 * under a Server Component layout that cannot hold client state itself.
 * `scrollToFarahPanel` is the exact function the mobile tab's own "Ask
 * Farah" button already uses for the same reason; calling it here means a
 * desktop reader mid-feed and a phone reader both land on the seeded panel,
 * with no separate mobile-specific wiring.
 */

export interface FarahJobMenuProps {
  jobId: string;
  jobTitle: string;
  companyName: string;
}

export function FarahJobMenu({ jobId, jobTitle, companyName }: FarahJobMenuProps) {
  return (
    <button
      type="button"
      onClick={() => {
        seedFarahForJob({ jobId, jobTitle, companyName });
        scrollToFarahPanel();
      }}
      className="inline-flex min-h-10 items-center py-2 text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
    >
      Ask Farah
    </button>
  );
}
