/**
 * An in-memory stand-in for the two things the signup-code limiter uses from the service-role client: the `consume_anonymous_rate_limit` RPC (0117) and a
 * read of `anonymous_rate_limits`. Time is `Date.now()`, so a test moves the clock with vi.setSystemTime. Same fixed, clock-aligned windows as 0117.
 * Like tests/support/fake-anonymous-rate-limit.ts it is only as right as its reading of 0117; the real function is proven by the DB-backed suites.
 */
export interface FakeRateLimitDb {
  /** "<key>\0<bucket>\0<windowStartSeconds>" -> count */
  counts: Map<string, number>;
  /** every rate_key that was ever written, for "no email in a key" assertions */
  keys(): string[];
  /** (bucket) -> total of all counts, across keys and windows */
  total(bucket: string): number;
  rpcCalls: Array<{ key: string; bucket: string }>;
  failRpc: boolean;
  failSelect: boolean;
  rpc(name: string, args: { p_key: string; p_bucket: string; p_limit: number; p_window_seconds: number }): Promise<{ data: Array<{ allowed: boolean; used: number; resets_at: string }> | null; error: Error | null }>;
  from(table: string): unknown;
}

export function createFakeRateLimitDb(): FakeRateLimitDb {
  const db: FakeRateLimitDb = {
    counts: new Map(),
    keys: () => [...new Set([...db.counts.keys()].map((k) => k.split("\u0000")[0]))],
    total: (bucket) => [...db.counts].filter(([k]) => k.split("\u0000")[1] === bucket).reduce((n, [, v]) => n + v, 0),
    rpcCalls: [],
    failRpc: false,
    failSelect: false,
    async rpc(name, args) {
      if (name !== "consume_anonymous_rate_limit") return { data: null, error: new Error(`unexpected rpc ${name}`) };
      if (db.failRpc) return { data: null, error: new Error("rpc down") };
      const w = args.p_window_seconds;
      const start = Math.floor(Date.now() / 1000 / w) * w;
      const rowKey = `${args.p_key}\u0000${args.p_bucket}\u0000${start}`;
      const count = (db.counts.get(rowKey) ?? 0) + 1;
      db.counts.set(rowKey, count);
      db.rpcCalls.push({ key: args.p_key, bucket: args.p_bucket });
      return { data: [{ allowed: count <= args.p_limit, used: count, resets_at: new Date((start + w) * 1000).toISOString() }], error: null };
    },
    from(table: string) {
      if (table !== "anonymous_rate_limits") throw new Error(`unexpected table ${table}`);
      const eq: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: string) => ((eq[c] = v), q),
        maybeSingle: async () => {
          if (db.failSelect) return { data: null, error: new Error("select down") };
          const start = Math.round(new Date(eq.window_start).getTime() / 1000);
          const count = db.counts.get(`${eq.rate_key}\u0000${eq.bucket}\u0000${start}`);
          return { data: count === undefined ? null : { request_count: count }, error: null };
        },
      };
      return q;
    },
  };
  return db;
}
