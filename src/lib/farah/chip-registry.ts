import { JOB_FIT_ENTRY_POINT } from "./job-seed";

/**
 * The ONE place a Farah chip is defined (S3-66, A1).
 *
 * A chip used to need four things in four places: the chip list (quick-actions.ts), its per-chip instruction (chat-prompt.ts), the keys the chat
 * route accepts (chat/route.ts) and the entry points the database allows (session-events.ts and the check constraint in migrations 0097/0124).
 * Nothing tied them together, so a chip added to one and forgotten in another failed silently. Each of those now READS this list, and
 * tests/farah/chip-registry.test.ts fails if any chip is missing from any consumer.
 *
 * ADDING A CHIP: add one entry here. Its `entryPoint` must be one the database check constraint allows (the test reads the newest migration that
 * defines it); a NEW entry point value needs a migration, which is a separate decision: until then log it as "free_text".
 *
 * Client-safe (no server imports): quick-actions.ts, used by the panel in the browser, derives from it.
 */
export type FarahChipEntryPoint = "interview-prep" | "career-advisor" | "salary-negotiation" | "job_fit" | "free_text";

export interface FarahChip {
  /** Sent as `quickAction`; also the key the instruction and the entry point are looked up by. */
  key: string;
  label: string;
  /** What a click puts in the user's own words; null for a chip that carries its own starters (job-seed.ts). */
  starterPrompt: string | null;
  /** "panel" chips are the three the docked panel lists; "job-seed" chips come from a job card's Ask Farah menu. */
  surface: "panel" | "job-seed";
  /** The value logged to farah_session_events.entry_point; must be allowed by that column's check constraint. */
  entryPoint: FarahChipEntryPoint;
  /** The per-chip instructions appended to the chat system prompt. Required: see validateChips. */
  instruction: string;
}

/** Written once so the "new request" statement cannot drift between actions. */
function newRequest(label: string): string {
  return `The user just started a NEW request from the "${label}" quick action. Do not continue an earlier topic from the history (e.g. a previous interview-prep discussion) unless they ask; answer this on its own terms.`;
}

export const FARAH_CHIPS: readonly FarahChip[] = [
  {
    key: "interview-prep",
    label: "Job Interview Prep",
    starterPrompt: "Help me prep for a job interview.",
    surface: "panel",
    entryPoint: "interview-prep",
    instruction: `${newRequest("Job Interview Prep")}

Job Interview Prep: if you do not know the role, company or stage, ask in one short question first. Then practise: one realistic question at a time, with feedback on their answer rather than a finished script. STAR is fine as a frame, but any example you write is a template with placeholders, not their story.`,
  },
  {
    key: "career-advisor",
    label: "Career Advisor",
    starterPrompt: "I'd like some career advice.",
    surface: "panel",
    entryPoint: "career-advisor",
    instruction: `${newRequest("Career Advisor")}

Career Advisor: the user wants career advice (direction, next moves, positioning), not interview practice, so give no practice questions or interview scripts. Unless it is already clear, first ask one or two short questions (where they are, where they want to go, how soon). Then give a few concrete options with trade-offs and one specific next step.`,
  },
  {
    key: "salary-negotiation",
    label: "Salary Negotiation",
    starterPrompt: "I want to prep for a salary negotiation.",
    surface: "panel",
    entryPoint: "salary-negotiation",
    instruction: `${newRequest("Salary Negotiation")}

Salary Negotiation: if you do not know their situation (an offer, a raise, a new role), ask in one short question first. Coach on strategy, framing and what to say; never state a market number or range you have no data for. For a real offer in hand, say a human mentor is the right next step.`,
  },
  {
    key: JOB_FIT_ENTRY_POINT,
    label: "Ask Farah about this job",
    starterPrompt: null,
    surface: "job-seed",
    entryPoint: "job_fit",
    instruction: `The user is asking about a specific job from their feed; the job context is below. Answer about THIS job only: how well it fits them and what to change on their resume for it. Only mention matched or missing skills that appear in that context.`,
  },
];

/** Throws if a chip has no instruction: a chip with none would silently fall back to "just its starter sentence" (the send-500 bug). */
export function validateChips(chips: readonly FarahChip[]): void {
  for (const chip of chips) {
    if (!chip.instruction || !chip.instruction.trim()) throw new Error(`chip-registry.ts: chip "${chip.key}" has no instruction`);
  }
}
validateChips(FARAH_CHIPS);

const BY_KEY = new Map(FARAH_CHIPS.map((c) => [c.key, c]));

/** Whether `key` is a chip that starts a chat (the route's allow-list). */
export function isChatChip(key: string | undefined): boolean {
  return key !== undefined && BY_KEY.has(key);
}

/** The entry point to log for a quick action key; anything unknown or absent is free text. */
export function chipEntryPoint(key: string | undefined): FarahChipEntryPoint {
  return (key !== undefined && BY_KEY.get(key)?.entryPoint) || "free_text";
}

export function chipInstruction(key: string): string | undefined {
  return BY_KEY.get(key)?.instruction;
}
