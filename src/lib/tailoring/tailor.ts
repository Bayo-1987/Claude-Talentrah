import "server-only";
import { getAnthropicClient } from "@/lib/farah/client";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import type { TailoringResult } from "./types";

const RESUME_SCHEMA = {
  type: "object",
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
};

const TAILOR_TOOL = {
  name: "record_tailoring",
  description:
    "Record the JD structuring, gap analysis, tailored resume, optional cover letter, and ATS assessment.",
  input_schema: {
    type: "object" as const,
    properties: {
      structuredJd: {
        type: "object",
        properties: {
          title: { type: "string" },
          seniority: { type: "string" },
          company: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
          responsibilities: { type: "array", items: { type: "string" } },
        },
        required: ["skills", "keywords", "responsibilities"],
      },
      gapAnalysis: {
        type: "array",
        description:
          "One entry per important keyword/skill from the JD — whether the resume already covers it.",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            status: { type: "string", enum: ["matched", "missing"] },
            note: {
              type: "string",
              description: "Short, specific note — e.g. how many times it appears in the JD vs. resume.",
            },
          },
          required: ["keyword", "status"],
        },
      },
      tailoredResume: {
        ...RESUME_SCHEMA,
        description:
          "The candidate's base resume, rewritten to emphasize what this specific JD asks for. Do not invent experience that isn't in the base resume — rephrase and reprioritize what's genuinely there.",
      },
      coverLetter: {
        type: "string",
        description: "A short, specific cover letter (3-4 paragraphs), or omit this field entirely if not requested.",
      },
      atsScore: {
        type: "integer",
        description: "0-100 ATS compatibility score for the tailored resume against this JD.",
      },
      atsFixes: {
        type: "array",
        items: { type: "string" },
        description: "2-5 short, specific, actionable fixes — e.g. \"add 'stakeholder management' — appears 3x in this JD, 0x in your resume\".",
      },
    },
    required: ["structuredJd", "gapAnalysis", "tailoredResume", "atsScore", "atsFixes"],
  },
};

export async function tailorResumeToJob(
  baseResume: StructuredResume,
  jdText: string,
  includeCoverLetter: boolean,
): Promise<TailoringResult> {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: FARAH_SYSTEM_PROMPT,
    tools: [TAILOR_TOOL],
    tool_choice: { type: "tool", name: "record_tailoring" },
    messages: [
      {
        role: "user",
        content: `Here is my base resume as JSON:\n${JSON.stringify(baseResume)}\n\nHere is the job description I want to tailor it to:\n${jdText.slice(0, 8000)}\n\n${includeCoverLetter ? "Include a cover letter." : "Do not include a cover letter."}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Farah didn't return a structured tailoring result.");
  }

  const input = toolUse.input as {
    structuredJd: TailoringResult["structuredJd"];
    gapAnalysis: TailoringResult["gapAnalysis"];
    tailoredResume: Partial<StructuredResume>;
    coverLetter?: string;
    atsScore: number;
    atsFixes: string[];
  };

  return {
    structuredJd: input.structuredJd,
    gapAnalysis: input.gapAnalysis ?? [],
    tailoredResume: {
      ...EMPTY_RESUME,
      ...input.tailoredResume,
      contact: { ...EMPTY_RESUME.contact, ...input.tailoredResume.contact },
    },
    coverLetter: includeCoverLetter ? (input.coverLetter ?? null) : null,
    atsScore: Math.max(0, Math.min(100, Math.round(input.atsScore ?? 0))),
    atsFixes: input.atsFixes ?? [],
  };
}
