/**
 * The match-score refresh now runs after EVERY ingest run (4 to 5 a day in practice), so it must stay free: scoring is a pure function, no LLM, no
 * embedding, no paid API. This pins that on the files the refresh executes, so a future "improvement" that adds a model call to scoring fails
 * here instead of showing up on the bill several times a day.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = [
  "src/lib/matching/refresh-users.ts",
  "src/lib/matching/refresh-job.ts",
  "src/lib/matching/post-ingest-refresh.ts",
  "src/lib/matching/score.ts",
  "src/lib/matching/role-fit.ts",
  "src/lib/matching/role-family.ts",
];

describe("the refresh makes no paid calls", () => {
  for (const file of FILES) {
    it(`${file} imports no LLM, embedding or network client`, () => {
      const src = readFileSync(file, "utf8");
      const imports = [...src.matchAll(/^\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/llm|embedding|openai|groq|gemini|anthropic|ai-sdk|farah/i);
      }
      expect(src, `${file} must not call fetch`).not.toMatch(/\bfetch\(/);
    });
  }
});
