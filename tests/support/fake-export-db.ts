/**
 * An in-memory stand-in for the Supabase query builder, for the account export (src/lib/account-export). It EVALUATES the filters the builder really sends
 * (`.eq`, `.in`, `.or("a.eq.X,b.eq.X")`), orders and pages with `.range`, and returns each row cut down to the columns the query asked for, so a column the
 * manifest does not select can never reach the code under test. It records every query; `select("*")` or an empty list throws, so a query that asks for
 * everything fails the test that ran it. An unknown chain method throws too, so a new shape fails loudly instead of being silently ignored.
 */

export type FakeRow = Record<string, unknown>;

export interface RecordedQuery {
  table: string;
  select: string;
  filters: string[];
}

export interface FakeExportDb {
  from: (table: string) => unknown;
  queries: RecordedQuery[];
}

export function fakeExportDb(tables: Record<string, FakeRow[]>): FakeExportDb {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    from(table: string) {
      const rows = tables[table] ?? [];
      const record: RecordedQuery = { table, select: "", filters: [] };
      const preds: Array<(r: FakeRow) => boolean> = [];
      let orderBy: string | null = null;
      let list: string[] = [];
      const chain: Record<string, unknown> = {
        select(cols: string) {
          if (!cols || cols.trim() === "*" || cols.includes("*")) throw new Error(`fake-export-db: select(${JSON.stringify(cols)}) on ${table} asks for everything`);
          record.select = cols;
          list = cols.split(",").map((c) => c.trim());
          return chain;
        },
        eq(col: string, v: unknown) {
          record.filters.push(`${col}=${String(v)}`);
          preds.push((r) => r[col] === v);
          return chain;
        },
        in(col: string, v: unknown[]) {
          record.filters.push(`${col} in (${v.length})`);
          preds.push((r) => v.includes(r[col]));
          return chain;
        },
        or(expr: string) {
          record.filters.push(`or(${expr})`);
          const clauses = expr.split(",").map((c) => {
            const m = /^([a-z_]+)\.eq\.(.+)$/.exec(c);
            if (!m) throw new Error(`fake-export-db: unsupported .or() clause ${c}`);
            return { col: m[1], v: m[2] };
          });
          preds.push((r) => clauses.some((c) => r[c.col] === c.v));
          return chain;
        },
        order(col: string) {
          orderBy = col;
          return chain;
        },
        maybeSingle() {
          queries.push(record);
          const first = rows.find((r) => preds.every((p) => p(r)));
          return Promise.resolve({ data: first ? Object.fromEntries(list.map((c) => [c, first[c]])) : null, error: null });
        },
        range(fromIdx: number, to: number) {
          queries.push(record);
          let matched = rows.filter((r) => preds.every((p) => p(r)));
          if (orderBy) {
            const key = orderBy;
            matched = [...matched].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
          }
          const page = matched.slice(fromIdx, to + 1).map((r) => Object.fromEntries(list.map((c) => [c, r[c]])));
          return Promise.resolve({ data: page, error: null });
        },
      };
      return new Proxy(chain, {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          if (prop === "then") return undefined;
          throw new Error(`fake-export-db: unmodelled query method .${prop}()`);
        },
      });
    },
  };
}
