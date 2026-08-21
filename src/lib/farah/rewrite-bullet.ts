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
 */
export async function rewriteBullet(
  text: string,
  instruction: BulletInstruction,
): Promise<string> {
  const prompt = `${INSTRUCTION_PROMPT[instruction]}

Return ONLY the rewritten bullet text, no preamble, no quotation marks, no explanation.

Original bullet: "${text}"`;

  const result = await askFarah(prompt, 256);
  return result.trim().replace(/^["']|["']$/g, "");
}
