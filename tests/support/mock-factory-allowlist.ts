/**
 * The factory-mock ratchet's ALLOWLIST (TEST-MOCK-1): the hand-written `vi.mock("<module>", () => ({ ... }))` factories still in the tree for the scoped shared modules (tests/support/mock-factory-ratchet.ts), keyed
 * "<module> :: <test file>". It starts as today's list (the vi.mock audit, reports/S3/34, with the ten chat-gate route tests already moved onto safeChatGate) and ONLY EVER SHRINKS: moving a file onto a shared helper or an
 * importOriginal spread (or deleting it) removes its entry here and lowers ALLOWLIST_CEILING in the same commit. tests/ci/mock-factory-ratchet.test.ts holds this exactly equal to what is really in the tree, so a new
 * hand-written factory fails, a converted file that is still listed fails, and the ceiling can never exceed what it started at.
 */
export const ALLOWLIST: Record<string, number> = {
  "@/lib/api/rate-limit :: tests/resume-builder/import-route-parse-fallback.test.ts": 1,
  "@/lib/api/rate-limit :: tests/tailoring/malformed-body.test.ts": 1,
  "@/lib/api/rate-limit :: tests/tailoring/route-credits-balance.test.ts": 1,
  "@/lib/auth/require-user :: tests/mentorship/own-profile-details-read.test.ts": 1,
  "@/lib/credits/gate-events :: tests/farah/chat-done-balance.test.ts": 1,
  "@/lib/credits/gate-events :: tests/farah/free-claim-gate.test.ts": 1,
  "@/lib/credits/gate-events :: tests/farah/message-charge-agreement.test.ts": 1,
  "@/lib/credits/gate-events :: tests/farah/next-free-message.test.ts": 1,
  "@/lib/credits/gate-events :: tests/resume-builder/rewrite-bullet-balance.test.ts": 1,
  "@/lib/credits/gate-events :: tests/tailoring/commit-balance.test.ts": 1,
  "@/lib/farah/client :: tests/farah/chat-route-allowance-skip.test.ts": 1,
  "@/lib/farah/client :: tests/farah/chat-route-failed-requests-charge-nothing.test.ts": 1,
  "@/lib/farah/client :: tests/farah/chat-route-spend-ceiling.test.ts": 1,
  "@/lib/farah/session-events :: tests/farah/chat-route-failed-requests-charge-nothing.test.ts": 1,
  "@/lib/farah/session-events :: tests/farah/chat-route-spend-ceiling.test.ts": 1,
  "@/lib/farah/spend-tally :: tests/farah/chat-route-failed-requests-charge-nothing.test.ts": 1,
  "@/lib/farah/spend-tally :: tests/farah/chat-route-spend-ceiling.test.ts": 1,
  "@/lib/farah/spend-tally :: tests/setup.ts": 1,
  "@/lib/passes/entitlement :: tests/farah/chat-done-balance.test.ts": 1,
  "@/lib/passes/entitlement :: tests/farah/free-claim-gate.test.ts": 1,
  "@/lib/passes/entitlement :: tests/farah/message-charge-agreement.test.ts": 1,
  "@/lib/passes/entitlement :: tests/farah/next-free-message-wiring.test.ts": 1,
  "@/lib/passes/entitlement :: tests/farah/next-free-message.test.ts": 1,
  "@/lib/passes/entitlement :: tests/resume-builder/rewrite-bullet-balance.test.ts": 1,
  "@/lib/passes/entitlement :: tests/tailoring/commit-balance.test.ts": 1,
};

/** Must equal the sum of ALLOWLIST. Lower it with every conversion; raising it is a visible, reviewed act. */
export const ALLOWLIST_CEILING = 25;

/** How many hand-written factories the scoped modules had when the ratchet was introduced. Never changes: the ceiling may not exceed it. */
export const INITIAL_FACTORIES = 149;
