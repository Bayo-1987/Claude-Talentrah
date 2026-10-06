/**
 * The factory-mock ratchet's rules, as a pure function so they can be proven with synthetic data (tests/ci/mock-factory-ratchet-rules.test.ts). Same shape as tests/format/ratchet-check.ts: the allowlist is
 * held EXACTLY equal to what is really in the tree, so a new hand-written factory fails, a converted file that is still listed fails, and the ceiling can only fall.
 */

/** The shared modules whose hand-written factories are counted (the high-fan-out ones in the vi.mock audit, reports/S3/34). A hand-written factory for any other module is not this ratchet's business yet. */
export const SCOPED_MODULES: readonly string[] = [
  "@/lib/farah/chat-gate",
  "@/lib/farah/spend-tally",
  "@/lib/farah/client",
  "@/lib/farah/session-events",
  "@/lib/credits/spend",
  "@/lib/credits/gate-events",
  "@/lib/passes/entitlement",
  "@/lib/llm",
  "@/lib/auth/require-user",
  "@/lib/resend/client",
  "@/lib/analytics/posthog",
  "@/lib/flags/read",
  "@/lib/api/rate-limit",
];

export const keyOf = (module: string, file: string) => `${module} :: ${file}`;

export interface FactoryRatchetInput {
  /** One entry per hand-written factory found in a scoped module (a file that mocks one module twice appears twice). */
  hits: ReadonlyArray<{ module: string; file: string }>;
  allowlist: Readonly<Record<string, number>>;
  ceiling: number;
  initial: number;
}

const HELP =
  "Use the shared helper (safeSpendTally / safeChatGate in tests/farah/support/route-mocks.ts) or spread the real module: vi.mock(m, async (importOriginal) => ({ ...(await importOriginal<typeof import(m)>()), thing: vi.fn() })).";

export function checkFactoryRatchet({ hits, allowlist, ceiling, initial }: FactoryRatchetInput): string[] {
  const problems: string[] = [];
  const actual = new Map<string, number>();
  for (const h of hits) actual.set(keyOf(h.module, h.file), (actual.get(keyOf(h.module, h.file)) ?? 0) + 1);

  for (const [key, n] of actual) {
    const allowed = allowlist[key] ?? 0;
    if (n > allowed) {
      problems.push(
        allowed === 0
          ? `${key}: a hand-written vi.mock factory that is not allowlisted. A module that gains an export breaks it silently. ${HELP}`
          : `${key}: ${n} hand-written factories, only ${allowed} allowed. The allowlist may not grow. ${HELP}`,
      );
    } else if (n < allowed) {
      problems.push(`${key}: only ${n} hand-written factory left but ${allowed} allowed. Lower the allowlist (and the ceiling) to ${n}.`);
    }
  }
  for (const key of Object.keys(allowlist)) {
    if (!actual.has(key)) problems.push(`${key}: allowlisted but it has no hand-written factory any more. Delete the entry (and lower the ceiling).`);
  }

  const total = Object.values(allowlist).reduce((a, b) => a + b, 0);
  if (total !== ceiling) problems.push(`The allowlist totals ${total} but ALLOWLIST_CEILING is ${ceiling}. Keep them equal.`);
  if (ceiling > initial) problems.push(`ALLOWLIST_CEILING (${ceiling}) is above the ${initial} hand-written factories the ratchet started with. It may only shrink.`);
  return problems;
}
