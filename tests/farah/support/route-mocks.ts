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
    markEightyWarned: async () => false,
    markReachedWarned: async () => false,
  };
}
