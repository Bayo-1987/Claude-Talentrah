import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askFarahChat, type FarahChatTurn } from "@/lib/farah/client";
import { logFarahSessionMessage, type FarahEntryPoint } from "@/lib/farah/session-events";
import type { StructuredResume } from "@/lib/resume/types";

/** The only quick actions that actually start a chat — see quick-actions.ts. */
const CHAT_ENTRY_POINTS = new Set(["interview-prep", "career-advisor", "salary-negotiation"]);

function resolveEntryPoint(quickAction: string | undefined): FarahEntryPoint {
  return quickAction && CHAT_ENTRY_POINTS.has(quickAction)
    ? (quickAction as FarahEntryPoint)
    : "free_text";
}

const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_TURNS = 12;
/**
 * Farah chat has no credit/free-trial gating yet — build-prompt §6.5 itself
 * only says the informational layer is "free or credit-gated", leaving the
 * choice open, and it isn't part of this milestone's scope. This cap exists
 * purely as an abuse/cost safety net (unbounded authenticated LLM spend),
 * not a monetization mechanism — reuses farah_messages itself as the
 * counter rather than adding new schema for it.
 */
const MAX_USER_MESSAGES_PER_HOUR = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const quickAction = typeof body.quickAction === "string" ? body.quickAction : undefined;
  const context = quickAction ? { quickAction } : {};
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

  if (!message) {
    return NextResponse.json({ error: "Say something for Farah to respond to." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount, error: countError } = await supabase
    .from("farah_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", oneHourAgo);

  if (countError) {
    return NextResponse.json({ error: "Couldn't reach Farah — try again in a moment." }, { status: 500 });
  }
  if ((recentCount ?? 0) >= MAX_USER_MESSAGES_PER_HOUR) {
    return NextResponse.json(
      { error: "That's a lot of messages this hour — give it a little while and try again." },
      { status: 429 },
    );
  }

  // Best-effort, and independent of whether Farah's reply below succeeds —
  // this counts what the user actually did (sent a message from this entry
  // point), not whether a downstream LLM call happened to work. No
  // sessionId (an older client, or a caller that isn't the panel) just skips
  // logging rather than guessing one.
  if (sessionId) {
    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: resolveEntryPoint(quickAction) });
  }

  const { data: historyRows, error: historyError } = await supabase
    .from("farah_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);

  if (historyError) {
    return NextResponse.json({ error: "Couldn't reach Farah — try again in a moment." }, { status: 500 });
  }

  const { data: baseResumeRow } = await supabase
    .from("resumes")
    .select("structured_content")
    .eq("user_id", user.id)
    .eq("is_base", true)
    .maybeSingle();

  const baseResume = baseResumeRow?.structured_content as StructuredResume | null;
  const extraContext = baseResume
    ? `Context on this user, from their resume (only reference what's actually here — don't invent detail beyond it):\nSummary: ${baseResume.summary ?? "(none given)"}\nSkills: ${baseResume.skills.join(", ") || "(none given)"}\nMost recent role: ${baseResume.experience[0] ? `${baseResume.experience[0].title} at ${baseResume.experience[0].company}` : "(none given)"}`
    : undefined;

  const turns: FarahChatTurn[] = [
    ...[...(historyRows ?? [])]
      .reverse()
      .map((row) => ({
        role: row.role === "farah" ? ("assistant" as const) : ("user" as const),
        content: row.content,
      })),
    { role: "user", content: message },
  ];

  let reply: string;
  try {
    reply = await askFarahChat(turns, extraContext);
  } catch (err) {
    // Never surface the raw provider error to the client — a provider
    // SDK's error .message can embed the full JSON response body (internal
    // request details, account-billing detail, etc.), which is both leaky
    // and useless to a user. Log server-side for debugging (LLMProviderError
    // — src/lib/llm/errors.ts — carries which provider and what kind of
    // failure), return a clean, Farah-voiced message instead.
    console.error("Farah chat: LLM call failed", err);
    return NextResponse.json(
      { error: "Farah couldn't respond just now — try again in a moment." },
      { status: 502 },
    );
  }

  const { error: insertUserError } = await supabase
    .from("farah_messages")
    .insert({ user_id: user.id, role: "user", content: message, context });
  const { data: farahRow, error: insertFarahError } = await supabase
    .from("farah_messages")
    .insert({ user_id: user.id, role: "farah", content: reply, context })
    .select("id, created_at")
    .single();

  if (insertUserError || insertFarahError || !farahRow) {
    // The reply already happened and cost real money — surface it to the
    // user even if persistence failed, rather than losing the answer.
    return NextResponse.json({
      reply,
      id: null,
      createdAt: new Date().toISOString(),
      persisted: false,
    });
  }

  return NextResponse.json({
    reply,
    id: farahRow.id,
    createdAt: farahRow.created_at,
    persisted: true,
  });
}
