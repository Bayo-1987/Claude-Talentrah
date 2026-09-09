import "server-only";
import { askFarah } from "./client";

export type BulletInstruction = "impact" | "quantify" | "concise";

const INSTRUCTION_PROMPT: Record<BulletInstruction, string> = {
  impact: "Rewrite this resume bullet to be more impact-driven — lead with the outcome, not the task.",
  quantify: "Rewrite this resume bullet to include a plausible metric or quantified scope, based only on what's implied by the text itself — don't invent a specific number that isn't grounded in it.",
  concise: "Rewrite this resume bullet to be more concise, cutting filler words without losing the substance.",
};

/**
 * First real Farah/LLM feature (plan doc M4) — reused by the chat panel
 * (M6) and JD tailoring (M5) via the same askFarah() client.
 *
 * Rewrites the WHOLE SET of bullets for a role at once, not one line the
 * cursor happens to be on — the textarea this feeds (resume-editor.tsx)
 * has no per-line focus tracking, and adding it would be new UI state for
 * a plain `<textarea>` rather than a mechanical follow-on to the bullets
 * schema fix. This also matches what the button already did before an
 * entry could hold more than one bullet (rewrite everything in the field),
 * so a single-bullet entry's behavior is completely unchanged.
 */
export async function rewriteBullet(
  text: string,
  instruction: BulletInstruction,
): Promise<string> {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const isMultiple = lines.length > 1;

  // Multi-bullet prompt is a distinct shape, not just the single-bullet one
  // with more text stuffed in "Original bullet:" — the model needs to be
  // told there are several separate points to preserve as separate points,
  // and told explicitly not to add its own numbering or markers, since the
  // response is split back into `bullets` by newline (narrativePatch in
  // resume-editor.tsx) exactly like a freshly typed textarea would be.
  const prompt = isMultiple
    ? `${INSTRUCTION_PROMPT[instruction]} Apply this to EACH of the following resume bullet points for the same role — they are separate achievements, keep them as separate points, do not merge them into one.

Return ONLY the rewritten bullets, one per line, in the same order, with no numbering, no bullet markers ("-", "•", etc.), no preamble, and no explanation.

Original bullets:
${lines.map((l) => `- ${l}`).join("\n")}`
    : `${INSTRUCTION_PROMPT[instruction]}

Return ONLY the rewritten bullet text, no preamble, no quotation marks, no explanation.

Original bullet: "${text}"`;

  // Scales with how much there actually is to rewrite, capped so a role
  // with many bullets can't balloon into a request that eats into Groq's
  // per-minute token budget (CLAUDE.md's own TPM incident) — 6 bullets'
  // worth is already generous for one role.
  const maxTokens = isMultiple ? Math.min(lines.length, 6) * 160 : 256;

  const result = await askFarah(prompt, maxTokens);
  return result.trim().replace(/^["']|["']$/g, "");
}
