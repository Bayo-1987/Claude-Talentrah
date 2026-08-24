/**
 * Docked panel quick-actions (build-prompt §6.5 / §5 IA). CV Builder and
 * Cover Letter Builder are navigation shortcuts into the already-built,
 * already-credit-gated Resume Builder (M4) and JD tailoring (M5) flows —
 * §6.5 lists those as separate "inline actions", not new chat features, so
 * they don't get a chat starter. The other three open the chat with a
 * starter prompt and behave as normal conversation from there.
 */
export interface FarahQuickAction {
  key: string;
  label: string;
  href: string | null;
  starterPrompt: string | null;
}

export const FARAH_QUICK_ACTIONS: FarahQuickAction[] = [
  { key: "cv-builder", label: "CV Builder", href: "/resume-builder", starterPrompt: null },
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
    key: "cover-letter-builder",
    label: "Cover Letter Builder",
    href: "/tailor",
    starterPrompt: null,
  },
  {
    key: "salary-negotiation",
    label: "Salary Negotiation",
    href: null,
    starterPrompt: "I want to prep for a salary negotiation.",
  },
];
