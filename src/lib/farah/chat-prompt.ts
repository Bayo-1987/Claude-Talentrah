import { FARAH_SYSTEM_PROMPT } from "./system-prompt";
import { FARAH_CHIPS, chipInstruction, validateChips } from "./chip-registry";
import { DATA_BLOCK_RULE, isOnlyDataBlocks, labelAsData } from "./data-block";

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
export const REPLY_SIZE_RULE = `Keep each reply short — aim for under about 200 words — and offer to continue with the next part ("Want me to go deeper on any of this?") rather than writing one long document. When the person asks for a specific length ("500 words"), write to that length instead; if it will not fit in one reply, write the first part and say what comes next.`;

/**
 * A request to WRITE something ("write me 500 words about…") used to come back as questions alone, and a completed reply uses a free message
 * whatever it says, so the person spent one and got no draft. Draft first, with placeholders for what is missing, so the first reply is useful.
 * A question is the exception, not the default. Scoped to writing: the coaching quick actions keep their own "ask first" instructions.
 */
export const DRAFT_FIRST_RULE = `When the person asks you to write something (a cover letter, an email, a summary, a post) and some details are missing, do not reply with questions alone: write the draft anyway, putting [square brackets] where a detail is missing (for example [company name], [your role]), then list at most three things for them to fill in. Never invent the missing details. Ask a question instead of drafting only when no useful draft is possible without the answer, and then ask exactly one question. A quick action's own instructions about asking first still apply to that quick action.`;

/** The instructions for a quick action key, or undefined for free text and unknown keys. Exported for the tests. */
export function quickActionInstructions(key: string): string | undefined {
  return chipInstruction(key);
}

// A chip with no instruction would silently fall back to "just a starter sentence", which is the bug. The registry is the one place chips
// are defined; this re-checks it at import so it fails loudly in any test or build that loads this module.
validateChips(FARAH_CHIPS);

export function buildFarahChatSystemPrompt({
  quickAction,
  extraContext,
}: { quickAction?: string; extraContext?: string } = {}): string {
  const parts = [FARAH_SYSTEM_PROMPT, NO_INVENTED_ACHIEVEMENTS_RULE, REPLY_SIZE_RULE, DRAFT_FIRST_RULE];
  const instructions = quickAction ? quickActionInstructions(quickAction) : undefined;
  if (instructions) parts.push(instructions);
  if (extraContext) {
    // Anything that came from a posting or a resume reaches the model as labelled DATA (data-block.ts). The route already hands over labelled
    // blocks; a caller that passes plain text still gets it labelled (source "context"), never appended raw.
    parts.push(DATA_BLOCK_RULE);
    parts.push(isOnlyDataBlocks(extraContext) ? extraContext : labelAsData("context", extraContext));
  }
  return parts.join("\n\n");
}
