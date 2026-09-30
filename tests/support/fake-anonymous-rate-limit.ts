/**
 * An in-memory stand-in for `public.consume_anonymous_rate_limit` (0117), with
 * a clock the test controls.
 *
 * WHY THIS EXISTS (send-482). The limiter keeps its count in Postgres and takes
 * its time from Postgres `now()`, so nothing on the TypeScript side can inject
 * a clock: `consumeLoginRateLimit` has no clock parameter and the SQL has no
 * way to be told what time it is. A test that wants to sit a burst on a window
 * boundary therefore cannot do it against the real function. This module
 * re-implements the function's documented behaviour so a test can.
 *
 * WHAT IT COPIES, line for line from 0117:
 *
 *   v_window_start := to_timestamp(floor(extract(epoch from now()) / w) * w);
 *   insert ... values (key, bucket, v_window_start, 1)
 *     on conflict (rate_key, bucket, window_start)
 *     do update set request_count = request_count + 1
 *     returning request_count into v_count;
 *   return (v_count <= p_limit, v_count, v_window_start + w seconds);
 *
 * i.e. FIXED, clock-aligned windows; one row per (key, bucket, window); the
 * increment and the read are one step (here: one synchronous function body,
 * which JavaScript cannot interleave, exactly as the SQL row lock cannot be).
 *
 * WHAT IT DOES NOT PROVE. That the real SQL behaves this way. That is the job
 * of the tests that call the real function (tests/auth/resend-rate-limit.test.ts
 * and tests/security/login-rate-limit.test.ts, both against a real database).
 * This fake is only ever as right as its reading of 0117; if 0117 changes, this
 * file and the tests built on it must change with it.
 *
 * No network, no database, no env.
 */

export interface FakeRpcRow {
  allowed: boolean;
  used: number;
  resets_at: string;
}

export interface FakeRateLimitClock {
  /** Milliseconds since the epoch, as the fake database sees "now". */
  now: number;
}

interface RpcArgs {
  p_key: string;
  p_bucket: string;
  p_limit: number;
  p_window_seconds: number;
}

/**
 * `clock.now` is read on every call, then advanced by `stepMs` AFTER the call,
 * so a test can say "the first call happens 1 s before a boundary and each call
 * takes 100 ms" and get a deterministic burst that straddles it.
 */
export function createFakeAnonymousRateLimit(clock: FakeRateLimitClock, stepMs = 0) {
  const counts = new Map<string, number>();
  const calls: { at: number }[] = [];

  return {
    calls,
    /** Same shape as the `.rpc()` the real client exposes, for the one function the limiter calls. */
    async rpc(name: string, args: RpcArgs): Promise<{ data: FakeRpcRow[] | null; error: Error | null }> {
      if (name !== "consume_anonymous_rate_limit") {
        return { data: null, error: new Error(`fake rate-limit client: unexpected rpc "${name}"`) };
      }
      const w = args.p_window_seconds;
      const nowSeconds = clock.now / 1000;
      const windowStartSeconds = Math.floor(nowSeconds / w) * w;

      const rowKey = `${args.p_key}\u0000${args.p_bucket}\u0000${windowStartSeconds}`;
      const count = (counts.get(rowKey) ?? 0) + 1;
      counts.set(rowKey, count);

      calls.push({ at: clock.now });
      clock.now += stepMs;

      return {
        data: [
          {
            allowed: count <= args.p_limit,
            used: count,
            resets_at: new Date((windowStartSeconds + w) * 1000).toISOString(),
          },
        ],
        error: null,
      };
    },
  };
}

/** The first window boundary strictly after `ms`, for a window of `windowSeconds`. */
export function nextBoundaryMs(ms: number, windowSeconds: number): number {
  const w = windowSeconds * 1000;
  return (Math.floor(ms / w) + 1) * w;
}
