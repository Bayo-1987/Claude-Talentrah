/**
 * Docked panel quick-actions (build-prompt §6.5 / §5 IA).
 *
 * CV Builder and Cover Letter Builder — pure navigation shortcuts, `href`
 * set and `starterPrompt: null`, into /resume-builder and /tailor — were
 * dropped 2026-09-08. Every entry left here opens the chat with a starter
 * prompt and behaves as normal conversation from there; a generic
 * panel-wide link to either flow duplicated navigation already reachable
 * elsewhere without adding anything a conversation actually does. `href`
 * stays on the type — every remaining entry happens to be chat-only, but
 * the type itself still describes either shape.
 */
export interface FarahQuickAction {
  key: string;
  label: string;
  href: string | null;
  starterPrompt: string | null;
}

export const FARAH_QUICK_ACTIONS: FarahQuickAction[] = [
  {
    key: "interview-prep",
    label: "Job Interview Prep",
    href: null,
    starterPrompt: "Help me prep for a job interview.",
  },
  {
    key: "career-advisor",
    label: "Career Advisor",
    href: null,
    starterPrompt: "I'd like some career advice.",
  },
  {
    key: "salary-negotiation",
    label: "Salary Negotiation",
    href: null,
    starterPrompt: "I want to prep for a salary negotiation.",
  },
];
