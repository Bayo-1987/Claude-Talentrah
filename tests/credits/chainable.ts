/**
 * A minimal chainable Supabase query-builder stand-in for the mocked-boundary tests in this folder
 * (same shape as tests/farah/chat-route-job-seed.test.ts's `chainable`): every method call re-chains;
 * awaiting the chain directly resolves to `chainResult`, and `.maybeSingle()` / `.single()` resolve to
 * `singleResult` (or `chainResult` when no distinct one is given).
 */
export function chainable(chainResult: Record<string, unknown>, singleResult?: Record<string, unknown>): unknown {
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
