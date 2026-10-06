/**
 * The safe fakes for the chat route's collaborators that live outside the route. Use as a factory for vi.mock, which keeps every existing assertion in a route test untouched:
 *
 *   vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
 *
 * The default for these modules (tests/setup.ts) is unsafe on purpose: a route test that forgets them fails loudly instead of quietly writing to a shared counter.
 */
export function safeSpendTally(opts: { spentNano?: number } = {}) {
  let spent = opts.spentNano ?? 0;
  return {
    readSpendNano: async () => spent,
    addSpendNano: async (nano: number) => (spent += nano),
    markHalfwayWarned: async () => false,
  };
}

/**
 * The fake for the chat gate (`@/lib/farah/chat-gate`) in a route test. A hand-written factory carries only the functions its file needed on the day it was written, so a route change that calls
 * another gate function turns every such file red at once (the free-message claim added `releaseFarahChatAllowance`; the next-free date added `farahChatNextFreeMessageAt`). This carries EVERY export
 * of the real module, with harmless defaults, and the caller overrides only what its test asserts on:
 *
 *   vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance }));
 *
 * `checkFarahChatAllowance` and `commitFarahChatAllowance` have no default on purpose: a route test must say what the gate answers. tests/farah/safe-chat-gate.test.ts fails when the real module gains
 * an export this does not carry, so extending the module and forgetting this is caught there, not in ten route tests.
 */
class SafeInsufficientCreditsError extends Error {
  constructor(
    public required?: number,
    public available?: number,
    public capMessage?: string,
  ) {
    super("insufficient");
  }
}

export function safeChatGate(parts: {
  checkFarahChatAllowance: (...args: never[]) => unknown;
  commitFarahChatAllowance: (...args: never[]) => unknown;
  releaseFarahChatAllowance?: (...args: never[]) => unknown;
  farahChatFreeMessagesRemaining?: (...args: never[]) => unknown;
  farahChatNextFreeMessageAt?: (...args: never[]) => unknown;
  FARAH_CHAT_FREE_ALLOWANCE?: number;
  InsufficientCreditsError?: typeof SafeInsufficientCreditsError;
}) {
  return {
    InsufficientCreditsError: parts.InsufficientCreditsError ?? SafeInsufficientCreditsError,
    FARAH_CHAT_FREE_ALLOWANCE: parts.FARAH_CHAT_FREE_ALLOWANCE ?? 3,
    checkFarahChatAllowance: parts.checkFarahChatAllowance,
    commitFarahChatAllowance: parts.commitFarahChatAllowance,
    releaseFarahChatAllowance: parts.releaseFarahChatAllowance ?? (async () => undefined),
    farahChatFreeMessagesRemaining: parts.farahChatFreeMessagesRemaining ?? (async () => 3),
    farahChatNextFreeMessageAt: parts.farahChatNextFreeMessageAt ?? (async () => null),
  };
}
