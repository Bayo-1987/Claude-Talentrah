import "server-only";
import { extractResumeText } from "./extract-text";
import { heuristicParseResume } from "./heuristic-parse";
import { parseResumeWithClaude } from "./llm-fallback";
import type { ParseResult } from "./types";

export async function parseResumeFile(
  buffer: Buffer,
  mimeType: string,
): Promise<ParseResult> {
  const rawText = await extractResumeText(buffer, mimeType);
  const { resume, confidence } = heuristicParseResume(rawText);

  if (confidence === "high") {
    return { resume, confidence, usedFallback: false };
  }

  try {
    const llmResume = await parseResumeWithClaude(rawText);
    return { resume: llmResume, confidence: "high", usedFallback: true };
  } catch {
    // No API key configured yet, or the call failed — fall back to whatever
    // the heuristic parser managed rather than failing the upload outright.
    // The caller surfaces confidence: "low" so the UI can prompt the user to
    // fill in gaps manually.
    return { resume, confidence: "low", usedFallback: false };
  }
}
