import { NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/**
 * TEMPORARY — verifies GEMINI_API_KEY is actually set and working in whatever
 * Vercel environment scope serves this deployment (Production vs Preview).
 * Not app functionality; not linked from anywhere. Delete this route once
 * verification is done — do not leave it in the codebase.
 */
const DIAG_TOKEN = "957ad7212fd3797b00a4db74581605e9";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== DIAG_TOKEN) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: "Say OK." }] }],
      config: { maxOutputTokens: 20, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    });
    return NextResponse.json({ ok: true, keyLength: apiKey.length, reply: response.text });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: "gemini call failed", detail: err instanceof Error ? err.message.slice(0, 300) : String(err) },
      { status: 502 },
    );
  }
}
