import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { EMPTY_RESUME, type StructuredResume } from "./types";

const EXTRACTION_TOOL = {
  name: "record_resume",
  description: "Record the structured fields extracted from a resume.",
  input_schema: {
    type: "object" as const,
    properties: {
      contact: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          location: { type: "string" },
        },
      },
      summary: { type: "string" },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            company: { type: "string" },
            location: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            description: { type: "string" },
          },
          required: ["title", "company"],
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            school: { type: "string" },
            degree: { type: "string" },
            field: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["school"],
        },
      },
      skills: { type: "array", items: { type: "string" } },
      projects: { type: "array", items: { type: "string" } },
      certifications: { type: "array", items: { type: "string" } },
    },
    required: ["contact", "experience", "education", "skills"],
  },
};

/**
 * Only runs when the heuristic parser (heuristic-parse.ts) came back
 * low-confidence — this is the fallback path, not the primary one, per the
 * plan doc's "library/rules-first, LLM only for messy cases" decision.
 */
export async function parseResumeWithClaude(
  rawText: string,
): Promise<StructuredResume> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — the LLM fallback can't run. Configure it in .env.local.",
    );
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_resume" },
    messages: [
      {
        role: "user",
        content: `Extract structured fields from this resume text. Leave fields empty/omitted rather than guessing when the text doesn't clearly say so.\n\n---\n${rawText.slice(0, 15000)}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return structured resume data.");
  }

  const parsed = toolUse.input as Partial<StructuredResume>;
  return {
    ...EMPTY_RESUME,
    ...parsed,
    contact: { ...EMPTY_RESUME.contact, ...parsed.contact },
  };
}
