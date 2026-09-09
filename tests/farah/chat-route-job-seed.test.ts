/**
 * send-100's "no second gate" property, proven at the ROUTE level.
 *
 * chat-gate.test.ts already sabotage-proves the counter's exhaustion
 * behaviour exhaustively (3 free, 4th blocked, rolling window, Pass
 * fallback, etc.) — but `checkFarahChatAllowance`/`commitFarahChatAllowance`
 * take only a userId; they have no idea entry points or jobId exist. So the
 * one thing THAT suite structurally cannot catch is a route.ts regression
 * that special-cases job_fit into a different call, a skipped check, or an
 * extra parameter that quietly enables a second allowance. That is a
 * route-wiring question, not a gate-logic one, which is what this file
 * checks instead: the LLM provider, the entitlement gate, and Supabase are
 * all mocked at the module boundary so this stays a fast, pure test of
 * chat/route.ts's own control flow rather than a second copy of chat-gate's
 * own integration suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChat = vi.fn();
const logFarahSessionMessage = vi.fn();

/**
 * A minimal chainable Supabase query-builder stand-in. Every method call
 * re-chains; awaiting the chain directly (no terminal call — the shape
 * chat/route.ts's own count and history queries use) resolves to
 * `chainResult`, and `.maybeSingle()`/`.single()` resolve to `singleResult`
 * (or `chainResult` when no distinct one is given).
 */
function chainable(chainResult: Record<string, unknown>, singleResult?: Record<string, unknown>): unknown {
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(chainResult);
        if (prop === "maybeSingle" || prop === "single") return async () => singleResult ?? chainResult;
        return () => proxy;
      },
    },
  );
  return proxy;
}

let jobRow: { title: string; company_name: string } | null = null;
let scoreRow: { explanation: unknown } | null = null;

function fakeSupabase() {
  return {
    auth: { getUser },
    from(table: string) {
      if (table === "job_postings") return chainable({ data: jobRow, error: null });
      if (table === "match_scores") return chainable({ data: scoreRow, error: null });
      if (table === "resumes") return chainable({ data: null, error: null });
      if (table === "farah_messages") {
        return chainable(
          { count: 0, data: [], error: null },
          { data: { id: "m1", created_at: "2026-01-01T00:00:00.000Z" }, error: null },
        );
      }
      return chainable({ data: null, error: null });
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/farah/client", () => ({ askFarahChat }));
vi.mock("@/lib/farah/session-events", () => ({ logFarahSessionMessage }));
vi.mock("@/lib/farah/chat-gate", () => ({
  checkFarahChatAllowance,
  commitFarahChatAllowance,
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));

const { POST } = await import("@/app/api/farah/chat/route");

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/farah/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ALLOWANCE = {
  isFreeAllowance: true,
  isPassCovered: false,
  creditsSpent: 0,
  creditsAvailableAtCheck: 0,
  freeMessagesRemaining: 2,
};

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset().mockResolvedValue(ALLOWANCE);
  commitFarahChatAllowance.mockReset().mockResolvedValue(undefined);
  askFarahChat.mockReset().mockResolvedValue("A grounded reply.");
  logFarahSessionMessage.mockReset().mockResolvedValue(undefined);
  jobRow = { title: "Senior Backend Engineer", company_name: "Flutterwave" };
  scoreRow = { explanation: { matchedSkills: ["sql"], missingSkills: ["dbt"], seniorityAlignment: "match" } };
});

describe("job_fit shares the exact same gate call as every other entry point", () => {
  it("SABOTAGE-PROOF TARGET: checkFarahChatAllowance/commitFarahChatAllowance are called with ONLY the user id, jobId or not", async () => {
    await POST(makeRequest({ message: "Help me prep for an interview.", quickAction: "interview-prep" }));
    expect(checkFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(checkFarahChatAllowance).toHaveBeenCalledWith("route-test-user");
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(commitFarahChatAllowance).toHaveBeenCalledWith("route-test-user", ALLOWANCE);

    checkFarahChatAllowance.mockClear();
    commitFarahChatAllowance.mockClear();

    await POST(
      makeRequest({ message: "Why is this a good fit for me?", quickAction: "job_fit", jobId: "job-1" }),
    );
    // Same function, same single argument, same shape of second argument —
    // nothing about jobId's presence reaches either call. If a future
    // change threaded jobId into the gate (a second allowance, a bypass,
    // an extra check), this assertion is what would catch it.
    expect(checkFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(checkFarahChatAllowance).toHaveBeenCalledWith("route-test-user");
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(commitFarahChatAllowance).toHaveBeenCalledWith("route-test-user", ALLOWANCE);
  });

  it("grounds the reply with job context when jobId + a real match score are present", async () => {
    await POST(makeRequest({ message: "Why is this a good fit for me?", quickAction: "job_fit", jobId: "job-1" }));
    const [, extraContext] = askFarahChat.mock.calls[0] as [unknown, string | undefined];
    expect(extraContext).toContain("Senior Backend Engineer at Flutterwave");
  });

  it("degrades to ungrounded chat, not an error, when the job/score lookup comes up empty", async () => {
    jobRow = null;
    scoreRow = null;
    const res = await POST(
      makeRequest({ message: "Why is this a good fit for me?", quickAction: "job_fit", jobId: "missing-job" }),
    );
    expect(res.status).toBe(200);
    const [, extraContext] = askFarahChat.mock.calls[0] as [unknown, string | undefined];
    expect(extraContext).toBeUndefined();
  });

  it("free-text chat (no jobId at all) is unaffected — extraContext is undefined, not an empty job block", async () => {
    await POST(makeRequest({ message: "How's the weather today?" }));
    const [, extraContext] = askFarahChat.mock.calls[0] as [unknown, string | undefined];
    expect(extraContext).toBeUndefined();
  });
});
