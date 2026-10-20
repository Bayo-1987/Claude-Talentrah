/**
 * A service-role client whose WRITES can be made to fail on demand, for tests of code that must not trust a database write it never checked.
 *
 * Why this exists. The money-path tests run against a real database with only Paystack mocked, so a real `update` can never come back as `{ error }` or as
 * "0 rows matched". The code under test (src/lib/mentorship/payouts.ts) used to ignore both and report success. This wraps the REAL client in a Proxy:
 * every read, every rpc and every write that no rule matches goes to the real database untouched; a write that a rule matches is replaced by one of
 *   - "error": the write is NOT sent; the awaited result is `{ data: null, error: { code, message } }` (a database fault),
 *   - "zero":  the write is NOT sent; the awaited result is `{ data: [], error: null }` (a conditional update that matched no row),
 *   - "crash": the write is NOT sent; awaiting it THROWS (the process died right here: nothing after this line ever ran),
 *   - "error-after": the write IS sent and committed, and the awaited result is then an error (the answer was lost: the database did the work and the caller is told it failed).
 * A rule may carry `code` (the error's SQLSTATE, default XX000) and `onFire` (run just before the fault is delivered, e.g. to create the row a concurrent writer would have made).
 * Reads are covered too: op "select" on a table fails `.from(table).select(...)`. Every write, read and rpc that passes through is appended to `calls`, in order, so a test can
 * assert what happened before what.
 */
export type FaultOp = "update" | "insert" | "upsert" | "delete" | "select";
export type FaultMode = "error" | "zero" | "crash" | "error-after";

export interface FaultRule {
  table: string;
  op: FaultOp;
  mode: FaultMode;
  /** How many matching writes to fail (default 1). Use Infinity to fail every one. */
  times?: number;
  /** Narrow to a particular write by its payload (e.g. only the one that sets status to "paid"). */
  match?: (values: Record<string, unknown>) => boolean;
  /** The SQLSTATE of the injected error (mode "error" and "error-after"). Default XX000. */
  code?: string;
  /** Runs just before the fault is delivered. */
  onFire?: () => Promise<void> | void;
}

export interface WriteCall {
  kind: "write" | "read" | "rpc";
  table?: string;
  op: string;
  values?: Record<string, unknown>;
  /** What the wrapper did with it: sent to the database, or replaced by a fault. */
  outcome: "sent" | "error" | "zero" | "crash" | "error-after";
}

const FAULT_ERROR = { code: "XX000", message: "injected database fault", details: "", hint: "" };

export interface FaultyClient<T> {
  client: T;
  /** Make the next matching write(s) fail. */
  fail(rule: FaultRule): void;
  /** Every write and rpc seen, in order. */
  calls: WriteCall[];
  /** Forget every rule and the call log. */
  reset(): void;
}

export function createFaultyClient<T extends object>(real: T): FaultyClient<T> {
  const rules: Array<FaultRule & { remaining: number }> = [];
  const calls: WriteCall[] = [];

  function takeRule(table: string, op: FaultOp, values: Record<string, unknown>): FaultRule | null {
    for (const rule of rules) {
      if (rule.table !== table || rule.op !== op || rule.remaining <= 0) continue;
      if (rule.match && !rule.match(values)) continue;
      rule.remaining -= 1;
      return rule;
    }
    return null;
  }

  /** Wrap a filter builder so chaining (.eq, .is, .select ...) keeps working and only the final await is replaced. */
  function wrapFaulted(rule: FaultRule, builder: object): object {
    const mode = rule.mode;
    const handler: ProxyHandler<object> = {
      get(target, prop, receiver) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
            const deliver = async () => {
              if (rule.onFire) await rule.onFire();
              if (mode === "crash") throw new Error("simulated crash: the process died before this write");
              const fault = { ...FAULT_ERROR, code: rule.code ?? FAULT_ERROR.code };
              if (mode === "error-after") {
                // The write really happens; only the answer is lost.
                await (target as unknown as PromiseLike<unknown>);
                return { data: null, error: fault, count: null, status: 500, statusText: "Internal Server Error" };
              }
              return mode === "error" ? { data: null, error: fault, count: null, status: 500, statusText: "Internal Server Error" } : { data: [], error: null, count: 0, status: 200, statusText: "OK" };
            };
            return deliver().then(resolve, reject);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = (value as (...a: unknown[]) => unknown).apply(target, args);
          return next && typeof next === "object" ? new Proxy(next as object, handler) : next;
        };
      },
    };
    return new Proxy(builder, handler);
  }

  function wrapTable(table: string, tableBuilder: Record<string, unknown>): object {
    return new Proxy(tableBuilder, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function" || (prop !== "update" && prop !== "insert" && prop !== "upsert" && prop !== "delete" && prop !== "select")) return value;
        return (...args: unknown[]) => {
          const op = prop as FaultOp;
          const first = args[0];
          const values = (first && typeof first === "object" && !Array.isArray(first) ? first : {}) as Record<string, unknown>;
          const rule = takeRule(table, op, values);
          const built = (value as (...a: unknown[]) => object).apply(target, args);
          const kind = op === "select" ? "read" : "write";
          if (rule) {
            calls.push({ kind, table, op, values, outcome: rule.mode });
            return wrapFaulted(rule, built);
          }
          calls.push({ kind, table, op, values, outcome: "sent" });
          return built;
        };
      },
    });
  }

  const client = new Proxy(real as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "from" && typeof value === "function") {
        return (table: string) => wrapTable(table, (value as (t: string) => Record<string, unknown>).call(target, table));
      }
      if (prop === "rpc" && typeof value === "function") {
        return (name: string, ...rest: unknown[]) => {
          calls.push({ kind: "rpc", op: name, outcome: "sent" });
          return (value as (...a: unknown[]) => unknown).call(target, name, ...rest);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as T;

  return {
    client,
    calls,
    fail(rule) {
      rules.push({ ...rule, remaining: rule.times ?? 1 });
    },
    reset() {
      rules.length = 0;
      calls.length = 0;
    },
  };
}
