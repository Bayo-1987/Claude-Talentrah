/**
 * Sabotage-proof target #2 (Stage 3.1 brief): a file the parser genuinely
 * cannot read must land the "Import my CV" user in a usable state — a clear
 * inline error they can retry or route around — never an unhandled crash or
 * a generic 500. src/lib/resume/parse.ts already degrades gracefully for a
 * LOW-CONFIDENCE parse (see tests/resume/parse-fallback-logging.test.ts);
 * this file's job is narrower and specific to the NEW route: prove
 * /api/resume-builder/import's own try/catch around parseResumeFile
 * actually catches a hard read failure (a file pdf.js can't parse AT ALL,
 * not just one the heuristic extractor finds messy) and turns it into a
 * clean 422 — the same contract /api/resume/parse already has — rather than
 * introducing a new failure mode on top of an existing safety net.
 *
 * Auth and the rate limiter are mocked out, same pattern as
 * tests/tailoring/malformed-body.test.ts — this is about the parse-failure
 * path, not about who's calling or how often.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "test-user-id" } } }) },
  }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  consumeRateLimit: async () => ({ allowed: true, used: 1, resetsAt: null }),
  rateLimited: () => new Response(null, { status: 429 }),
}));

const { POST } = await import("@/app/api/resume-builder/import/route");

function multipartRequest(file: File): Request {
  const formData = new FormData();
  formData.set("file", file);
  return new Request("http://localhost/api/resume-builder/import", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/resume-builder/import — a file the parser cannot read at all", () => {
  it("returns a clean 422, not a crash — and never writes anywhere (this route makes no DB write at all)", async () => {
    // Not a PDF, not text, not a DOCX zip — genuinely unparseable bytes with
    // a PDF content-type, so extractResumeText's pdf-parse call throws
    // (invalid PDF structure) rather than degrading to a low-confidence
    // heuristic result. That's the harder failure this route has to survive:
    // a throw, not just a messy parse.
    const garbage = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])], "broken.pdf", {
      type: "application/pdf",
    });

    const response = await POST(multipartRequest(garbage));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatch(/couldn.t read that file/i);
  });

  it("a well-formed but skills-heading-mismatched .txt resume still succeeds (low confidence, not blocked)", async () => {
    // The DEGRADE case, not the HARD-FAILURE case above: parseResumeFile
    // itself never throws here (see parse.ts) — it falls back to the
    // heuristic result with confidence: "low". Confirms this route's own
    // try/catch doesn't accidentally treat that as an error too.
    const text = ["Ada Lovelace", "ada@example.com", "", "Experience", "PM", "Co", "Did things"].join("\n");
    const file = new File([text], "resume.txt", { type: "text/plain" });

    const response = await POST(multipartRequest(file));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resume.contact.email).toBe("ada@example.com");
    expect(["high", "low"]).toContain(body.confidence);
  });
});
