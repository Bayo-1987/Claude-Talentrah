import "server-only";
import { extractResumeText } from "./extract-text";
import { heuristicParseResume } from "./heuristic-parse";
import { parseResumeWithLLM } from "./llm-fallback";
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
    const llmResume = await parseResumeWithLLM(rawText);
    return { resume: llmResume, confidence: "high", usedFallback: true };
  } catch (err) {
    /*
     * No API key configured yet, or the call failed — fall back to whatever
     * the heuristic parser managed rather than failing the upload outright.
     * The caller surfaces confidence: "low" so the UI can prompt the user to
     * fill in gaps manually.
     *
     * LOGGED rather than discarded, which it was not before. This catch is
     * the last thing standing between a failed LLM call and a resume stored
     * with an empty skills array, and it was silent — so a user whose upload
     * degraded to a partial heuristic parse looked identical to a user who
     * had simply not listed any skills, with nothing anywhere recording which
     * had happened. That is the whole of issue #139: the heading pattern
     * missed, this fired, and no one could tell.
     *
     * Production runs Gemini on a shared free-tier key (CLAUDE.md), so a
     * quota rejection here is an ordinary event, not an exotic one. It should
     * be visible.
     */
    console.error("[resume-parse] LLM fallback failed; storing heuristic parse", {
      skills: resume.skills.length,
      experience: resume.experience.length,
      textLength: rawText.length,
    }, err);
    return { resume, confidence: "low", usedFallback: false };
  }
}
