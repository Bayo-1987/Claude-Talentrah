import { FARAH_SYSTEM_PROMPT } from "./system-prompt";
import { FARAH_QUICK_ACTIONS } from "./quick-actions";
import { JOB_FIT_ENTRY_POINT } from "./job-seed";

/**
 * The system prompt for Farah's docked CHAT panel (send-500), assembled per request.
 *
 * WHY THIS EXISTS. The shared prompt (system-prompt.ts) is one block for every surface, and `chat/route.ts` used
 * to hand the model that block plus the user's resume grounding and nothing about WHICH entry point the message
 * came from: the quick action was written into the transcript's `context` and never reached the model. A quick
 * action was therefore just its starter sentence. A vague starter ("I'd like some career advice.") continues
 * whatever the replayed history is about, and the turn before the owner's Career Advisor click was an Interview
 * Prep one, so the reply was an interview plan.
 *
 * Chat only, deliberately: the shared prompt also serves one-shot callers (bullet rewrite, scholarship drafts)
 * whose own prompts and tests this should not touch, and the rules below are about what a CONVERSATION writes.
 */

/**
 * Found by the owner's report: a Career Advisor click produced an interview plan whose STAR stories read as the
 * user's own ("Validated $2 M TAM; secured $500k budget", "15 pilot merchants", a named tool), none of which they
 * had said. The shared prompt already said "never invent facts about the user's experience" and that was not
 * enough: the model reads a worked example as help, not as a claim. This names the failure by its parts.
 */
export const NO_INVENTED_ACHIEVEMENTS_RULE = `Never invent achievements, metrics or employers for the user. When you write an example answer, a story, a resume bullet or talking points for them, do not state any number, figure, percentage, headcount, client count, budget, tool, employer or outcome that the user has not told you or that is not in their resume context. Where a detail like that is needed, write a placeholder such as [your metric], [your tool] or [your outcome] and tell them to fill it with something true. An example you write is a template for them to fill in, never a claim about what they have done: do not present an invented story as theirs.`;

/**
 * Chat replies render in a ~280px column and are capped at CHAT_MAX_OUTPUT_TOKENS. A reply that reaches the cap is
 * cut off mid-sentence (and is not charged: see chat/route.ts), so ask for a size that normally finishes.
 */
export const REPLY_SIZE_RULE = `Keep each reply short — aim for under about 200 words — and offer to continue with the next part ("Want me to go deeper on any of this?") rather than writing one long document.`;

/** Written once so the "new request" statement cannot drift between actions. */
function newRequest(label: string): string {
  return `The user just started a NEW request from the "${label}" quick action. Do not continue an earlier topic from the history (e.g. a previous interview-prep discussion) unless they ask; answer this on its own terms.`;
}

const INSTRUCTIONS: Record<string, string> = {
  "interview-prep": `${newRequest("Job Interview Prep")}

Job Interview Prep: if you do not know the role, company or stage, ask in one short question first. Then practise: one realistic question at a time, with feedback on their answer rather than a finished script. STAR is fine as a frame, but any example you write is a template with placeholders, not their story.`,

  "career-advisor": `${newRequest("Career Advisor")}

Career Advisor: the user wants career advice (direction, next moves, positioning), not interview practice, so give no practice questions or interview scripts. Unless it is already clear, first ask one or two short questions (where they are, where they want to go, how soon). Then give a few concrete options with trade-offs and one specific next step.`,

  "salary-negotiation": `${newRequest("Salary Negotiation")}

Salary Negotiation: if you do not know their situation (an offer, a raise, a new role), ask in one short question first. Coach on strategy, framing and what to say; never state a market number or range you have no data for. For a real offer in hand, say a human mentor is the right next step.`,

  [JOB_FIT_ENTRY_POINT]: `The user is asking about a specific job from their feed; the job context is below. Answer about THIS job only: how well it fits them and what to change on their resume for it. Only mention matched or missing skills that appear in that context.`,
};

/** The instructions for a quick action key, or undefined for free text and unknown keys. Exported for the tests. */
export function quickActionInstructions(key: string): string | undefined {
  return Object.hasOwn(INSTRUCTIONS, key) ? INSTRUCTIONS[key] : undefined;
}

// A quick action added to quick-actions.ts with no instructions here would silently fall back to "just a starter
// sentence", which is the bug. Checked once at import so it fails loudly in any test or build that loads this.
for (const action of FARAH_QUICK_ACTIONS) {
  if (action.starterPrompt && !Object.hasOwn(INSTRUCTIONS, action.key)) {
    throw new Error(`chat-prompt.ts: quick action "${action.key}" has no instructions`);
  }
}

export function buildFarahChatSystemPrompt({
  quickAction,
  extraContext,
}: { quickAction?: string; extraContext?: string } = {}): string {
  const parts = [FARAH_SYSTEM_PROMPT, NO_INVENTED_ACHIEVEMENTS_RULE, REPLY_SIZE_RULE];
  const instructions = quickAction ? quickActionInstructions(quickAction) : undefined;
  if (instructions) parts.push(instructions);
  if (extraContext) parts.push(extraContext);
  return parts.join("\n\n");
}
