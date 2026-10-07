/**
 * The chat route and the page chips: a page chip's click makes the route load that page's facts for THIS user (through the session client it already holds), hands the numbers to the model as facts and anything a
 * third party wrote as labelled untrusted data, and reads nothing from the request body but the chip's key and the ids. The loader is mocked here (it has its own tests); this file is the wiring.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const loadPageFacts = vi.fn();
const session: Record<string, unknown> = { auth: { getUser }, from: () => chainable({ count: 0, data: [], error: null }) };

function chainable(chainResult: Record<string, unknown>, singleResult?: Record<string, unknown>): unknown {
  const proxy: object = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(chainResult);
      if (prop === "maybeSingle" || prop === "single") return async () => singleResult ?? chainResult;
      return () => proxy;
    },
  });
  return proxy;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session }));
// the route saves the exchange through the service-role client; the same fake answers it (the saved row is not what this file is about)
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => session }));
vi.mock("@/lib/farah/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/client")>()), askFarahChatStream }));
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
vi.mock("@/lib/farah/page-facts-load", () => ({ loadPageFacts }));
const { POST } = await import("@/app/api/farah/chat/route");

const FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 1 };
const ID = "123e4567-e89b-42d3-a456-426614174000";
const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "A question", ...body }) }));
type Opts = { quickAction?: string; facts?: string };
let seen: { turns?: unknown; extra?: string; opts?: Opts };

beforeEach(() => {
  seen = {};
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset().mockResolvedValue(FREE);
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  loadPageFacts.mockReset().mockResolvedValue({ facts: "FACTS-FOR-THE-PAGE", data: "DATA-WRITTEN-BY-OTHERS" });
  askFarahChatStream.mockReset().mockImplementation(async function* (turns: unknown, extra: string | undefined, _m: unknown, opts?: Opts) {
    seen = { turns, extra, opts };
    yield "A reply.";
  });
});

describe("a page chip loads its page's facts for this user, through the session client", () => {
  const CASES: Array<[string, string]> = [
    ["jobs-missing-skills", "jobs"], ["scholarships-due-soonest", "scholarships"], ["resume-weakest", "resume-builder"], ["tailor-wants", "tailor"],
    ["tracker-follow-up-week", "tracker"], ["auto-apply-sends", "auto-apply"], ["mentorship-pick", "mentorship"], ["review-involves", "talent-directory"], ["refer-how", "refer"],
  ];
  it.each(CASES)("%s -> %s", async (key, kind) => {
    await (await post({ quickAction: key })).text();
    expect(loadPageFacts).toHaveBeenCalledTimes(1);
    const args = loadPageFacts.mock.calls[0][0];
    expect(args.kind).toBe(kind);
    expect(args.userId).toBe("route-test-user");
    expect(args.supabase).toBe(session); // the signed-in session client, never a service-role one
    expect(seen.opts?.facts).toBe("FACTS-FOR-THE-PAGE");
  });

  it("the ids the click carries are handed to the loader; the loader validates them", async () => {
    await (await post({ quickAction: "tracker-word-follow-up", applicationId: ID, scholarshipId: ID, jobId: ID })).text();
    expect(loadPageFacts.mock.calls[0][0].ids).toEqual({ jobId: ID, scholarshipId: ID, applicationId: ID });
  });
  it("an id that is not a string is dropped before it reaches the loader", async () => {
    await (await post({ quickAction: "tracker-word-follow-up", applicationId: { $ne: null }, scholarshipId: 5 })).text();
    expect(loadPageFacts.mock.calls[0][0].ids).toEqual({});
  });
});

describe("third-party text is labelled data, never facts", () => {
  it("scholarship text is a scholarship block; other pages' text is a context block; neither holds the facts", async () => {
    await (await post({ quickAction: "scholarships-good-fit" })).text();
    expect(seen.extra).toContain('<untrusted_data source="scholarship">\nDATA-WRITTEN-BY-OTHERS\n</untrusted_data>');
    expect(seen.extra).not.toContain("FACTS-FOR-THE-PAGE");
    await (await post({ quickAction: "tracker-follow-up-week" })).text();
    expect(seen.extra).toContain('<untrusted_data source="context">\nDATA-WRITTEN-BY-OTHERS\n</untrusted_data>');
  });
  it("a page with no third-party text adds no block", async () => {
    loadPageFacts.mockResolvedValue({ facts: "ONLY-FACTS" });
    await (await post({ quickAction: "refer-how" })).text();
    expect(seen.extra ?? "").not.toContain("untrusted_data");
  });
});

describe("only the chip's key and the ids are read from the request", () => {
  it("a price, a balance, a count or a whole facts block in the body changes nothing", async () => {
    await (await post({ quickAction: "auto-apply-free-runs", facts: "Free runs left: 99", freeRemaining: 99, balance: 999999, price: 1, quota: { freeRemaining: 99 } })).text();
    expect(loadPageFacts.mock.calls[0][0]).not.toHaveProperty("quota");
    expect(seen.opts?.facts).toBe("FACTS-FOR-THE-PAGE");
    expect(JSON.stringify(loadPageFacts.mock.calls[0][0].ids)).not.toContain("99");
  });
});

describe("whose records are read", () => {
  it("always the signed-in user's, whatever the body says", async () => {
    await (await post({ quickAction: "tracker-follow-up-week", userId: "someone-else", user_id: "someone-else", user: { id: "someone-else" } })).text();
    expect(loadPageFacts.mock.calls[0][0].userId).toBe("route-test-user");
  });
});

describe("what does not load page facts", () => {
  it("a typed message, today's three chips, an unknown key and the billing chips never call the page loader", async () => {
    for (const body of [{}, { quickAction: "interview-prep" }, { quickAction: "career-advisor" }, { quickAction: "salary-negotiation" }, { quickAction: "not-a-chip" }, { quickAction: "billing-use-credits" }]) {
      loadPageFacts.mockClear();
      await (await post(body)).text();
      expect(loadPageFacts, JSON.stringify(body)).not.toHaveBeenCalled();
    }
  });
});

describe("a loader that fails does not break the chat", () => {
  it("the reply still happens, with no facts, and the failure is logged without any content", async () => {
    loadPageFacts.mockRejectedValue(new Error("secret internal detail 4c9e"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ quickAction: "jobs-missing-skills", message: "a distinctive question 71b2" });
    expect(res.status).toBe(200);
    await res.text();
    expect(askFarahChatStream).toHaveBeenCalledTimes(1);
    expect(seen.opts?.facts).toBeUndefined();
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("[farah-page-facts]");
    expect(logged).not.toContain("4c9e");
    expect(logged).not.toContain("71b2");
    err.mockRestore();
  });
});
