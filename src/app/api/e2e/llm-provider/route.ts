import { NextResponse } from "next/server";

/**
 * Lets the e2e suite confirm the app it is driving has the stub LLM
 * provider active, before it runs a journey that would otherwise make real
 * model calls (see e2e/fixtures/authed.ts → requireStubbedLlm).
 *
 * Answers 200 ONLY when the stub is active, and 404 otherwise — so on a
 * normal deployment this endpoint simply does not exist and reveals nothing
 * about configuration. It never returns a key, a model name, or anything
 * beyond the single boolean the test needs.
 */
export async function GET() {
  if (process.env.LLM_PROVIDER !== "stub") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ stubbed: true });
}
