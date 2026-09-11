/**
 * PR #319 (the credit gate) and PR #320 (Groq rate-limit failover) both edit
 * route.ts's same try/catch around the LLM call — #319 wraps it from outside
 * (check before, commit after), #320 only reshapes the catch block's error
 * message. Individually correct, and a rebase merged them without a
 * conflict, but that only proves the two diffs applied to disjoint lines —
 * not that a rate-limited LLM call still skips commitFarahChatAllowance the
 * way it's supposed to. That's exactly the kind of thing two independently
 * correct diffs can get wrong together, so it gets its own real test rather
 * than being reasoned about after the fact.
 *
 * Mocks only the true external boundaries: the request-scoped Supabase
 * client (createClient, which needs next/headers' cookies() and has no
 * meaning outside an actual request) and the LLM call itself. Everything
 * else — POST from the real route.ts, and checkFarahChatAllowance /
 * commitFarahChatAllowance from chat-gate.ts — runs unmocked. chat-gate.ts
 * uses its own service-role client (createServiceRoleClient), independent
 * of route.ts's request-scoped one, so its reads/writes hit the real
 * database and are asserted against directly, the same way
 * tests/farah/chat-gate.test.ts already does for the check/commit functions
 * on their own.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestUser, deleteTestUsers, admin } from "../support/auth";
import { LLMProviderError } from "@/lib/llm";

const askFarahChatStream = vi.fn();
vi.mock("@/lib/farah/client", () => ({
  askFarahChatStream: (...args: unknown[]) => askFarahChatStream(...args),
}));

/** A chain stub covering exactly the methods route.ts calls before the LLM call — count-style (recentCount), array-style (history), and maybeSingle-style (base resume) all read from the same merged shape. */
function chain(result: Record<string, unknown>) {
  const c: Record<string, unknown> = {
    select: () => c,
    eq: () => c,
    gte: () => c,
    order: () => c,
    limit: () => c,
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return c;
}

let userId: string;

beforeAll(async () => {
  const user = await createTestUser("chatroute");
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await admin.from("credit_gate_events").delete().eq("user_id", userId);
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: (table: string) => {
      if (table === "farah_messages") return chain({ data: [], count: 0, error: null });
      if (table === "resumes") return chain({ data: null, error: null });
      throw new Error(`unexpected table in test stub: ${table}`);
    },
  }),
}));

it("a rate-limited LLM call streams an in-body error and never commits the free-message allowance", async () => {
  // Throws on the FIRST pull, before yielding anything — the shape a real
  // rate-limit failure takes when it happens before the primary provider
  // (or its failover — see generateChatStreamWithFailover's own comment)
  // ever produces a token.
  askFarahChatStream.mockImplementationOnce(async function* () {
    throw new LLMProviderError("groq", "rate_limit", "Please try again in 12m45.504s.");
  });

  const { farahChatFreeMessagesRemaining, FARAH_CHAT_FREE_ALLOWANCE } = await import("@/lib/farah/chat-gate");
  const before = await farahChatFreeMessagesRemaining(userId);
  expect(before).toBe(FARAH_CHAT_FREE_ALLOWANCE);

  const { POST } = await import("@/app/api/farah/chat/route");
  const response = await POST(
    new Request("http://localhost/api/farah/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Help me prep for an interview." }),
    }),
  );

  // Streaming means the route can no longer return 502 for an error that
  // surfaces after the response has started — the status is always 200 once
  // streaming begins, and failure is now an in-body "error" event instead
  // (see chat/route.ts's own comment on why headers can't change mid-stream).
  expect(response.status).toBe(200);
  // .text() drains the stream to completion, which is what actually waits
  // for the route's internal work (here: NOT calling commitFarahChatAllowance)
  // to finish — awaiting POST() alone only waits for the Response object to
  // be constructed, not for the stream's own async start() callback to run.
  const body = await response.text();
  const events = body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const errorEvent = events.find((e) => e.type === "error");
  // send-111's rate-limit-aware copy specifically, not the generic fallback —
  // proves #320's message-shaping and #319's gate are both live on this path.
  expect(errorEvent?.message).toBe("Farah's hit her limit for right now — try again in about 13 minutes.");
  expect(events.find((e) => e.type === "done")).toBeUndefined();

  // THE ASSERTION THIS TEST EXISTS FOR: the failed call must not have
  // touched the allowance. If commitFarahChatAllowance had run anyway, this
  // would now read FARAH_CHAT_FREE_ALLOWANCE - 1.
  const after = await farahChatFreeMessagesRemaining(userId);
  expect(after).toBe(FARAH_CHAT_FREE_ALLOWANCE);

  const { count, error } = await admin
    .from("credit_gate_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  expect(error).toBeNull();
  expect(count, "a failed reply must not write a credit_gate_events row at all").toBe(0);
});
