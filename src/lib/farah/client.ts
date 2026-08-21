import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { FARAH_SYSTEM_PROMPT } from "./system-prompt";

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — Farah's AI features need it configured in .env.local.",
    );
  }
  return new Anthropic({ apiKey });
}

/** One-shot text completion with Farah's voice as the system prompt. */
export async function askFarah(userMessage: string, maxTokens = 1024): Promise<string> {
  const client = getAnthropicClient();
  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: maxTokens,
    system: FARAH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Farah didn't return a text response.");
  }
  return textBlock.text;
}
