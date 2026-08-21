import { EyebrowLabel } from "@/components/ui";

const QUICK_ACTIONS = [
  "Resume Builder",
  "Interview Prep",
  "Career Advisor",
  "Cover Letter",
  "Salary Negotiation",
];

export interface FarahPanelProps {
  firstName: string;
}

/**
 * Marginalia panel per design handoff §7 — 280px column, border-left only,
 * no card background. Quick actions and chat are visual-only placeholders
 * until M6 wires Farah up for real; matches the reference mockup's own
 * inert `href="#"` links rather than pretending this works today.
 */
export function FarahPanel({ firstName }: FarahPanelProps) {
  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col gap-5.5 border-l border-line py-8 pl-7">
      <div>
        <span className="font-body text-[13px] font-bold text-ink">{firstName}</span>
        <div>
          <a href="/settings" className="text-[12.5px] underline underline-offset-2">
            View profile
          </a>
        </div>
      </div>

      <div className="border-t border-line pt-4.5">
        <EyebrowLabel size="sm">Farah — your co-pilot</EyebrowLabel>
        <p className="mt-2.5 font-display text-[14.5px] italic leading-relaxed text-ink-soft">
          &ldquo;Hi {firstName} — I can tailor your resume to any of these
          roles, or help you prep. What do you need?&rdquo;
        </p>
      </div>

      <div className="flex flex-col border-t border-dashed border-line pt-4">
        {QUICK_ACTIONS.map((action) => (
          <span
            key={action}
            aria-disabled
            title="Coming soon"
            className="flex min-h-10 cursor-not-allowed items-center py-1 font-body text-[13.5px] font-semibold text-ink underline decoration-line underline-offset-2 opacity-60"
          >
            {action}
          </span>
        ))}
      </div>

      <div
        aria-disabled
        title="Coming soon"
        className="mt-auto flex items-center gap-2 border border-line bg-card px-2.5 py-2 opacity-60"
      >
        <span className="flex-1 font-display text-[12.5px] italic text-ink-soft">
          Ask me anything…
        </span>
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink text-paper">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 10 L17 3 L11 17 L9 11 L3 10Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}
