/**
 * A stand-in for the Supabase query builder that behaves the way the API roles will behave once 0232 narrows four public tables
 * (organizations, scholarships, blog_posts, mentorship_reviews): a query whose select list is `*`, is empty, or names a withheld column
 * (directly, in an embed such as `organizations(*)`, or as a filter or sort) is REFUSED with SQLSTATE 42501, exactly as PostgREST answers it;
 * a query that names only readable columns gets rows back with only those columns in them.
 *
 * It exists so a call site can be proven against the new grants without a database: the real-database test (tests/rls/identifier-column-grants.test.ts,
 * part of the migration pull request) can only run once 0232 is applied, and this runs everywhere today. It does NOT evaluate filters:
 * the rows a table holds are returned as given, because what is under test is whether the SELECT LIST is acceptable, not what the filters keep.
 *
 * An unknown chain method throws, so a call site that starts using one this does not model fails loudly instead of passing by accident.
 */

export const WITHHELD: Record<string, readonly string[]> = {
  organizations: ["cac_number", "cac_business_name", "cac_confirmed_by", "created_by"],
  scholarships: ["moderation_note", "moderated_by"],
  blog_posts: ["created_by", "updated_by"],
  mentorship_reviews: ["reviewer_id", "session_id"],
};

export interface GrantsError {
  code: "42501";
  message: string;
}

/** Splits a select list at its top-level commas (a comma inside an embed's parentheses does not split it). */
export function splitSelectList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `alias:table!hint(cols)` -> { table, cols }; null for a plain column. */
function parseEmbed(part: string): { table: string; cols: string } | null {
  const m = /^(?:[\w]+:)?([\w]+)(?:![\w]+)?\(([\s\S]*)\)$/.exec(part);
  return m ? { table: m[1], cols: m[2] } : null;
}

/** The refusal for `table` selecting `list`, or null if every column is readable. */
export function refusalFor(table: string, list: string | undefined): GrantsError | null {
  const withheld = WITHHELD[table] ?? [];
  const refuse = (what: string): GrantsError => ({ code: "42501", message: `permission denied for table ${table} (${what})` });
  const trimmed = (list ?? "").trim();
  // `*` needs every column readable, which is only a problem on a table that has a withheld one.
  if ((trimmed === "" || trimmed === "*") && table in WITHHELD) return refuse("select * needs every column");
  for (const part of splitSelectList(trimmed)) {
    const embed = parseEmbed(part);
    if (embed) {
      const inner = refusalFor(embed.table, embed.cols);
      if (inner) return inner;
      continue;
    }
    if ((part === "*" || part.endsWith(".*")) && table in WITHHELD) return refuse("select * needs every column");
    const bare = part.replace(/^[\w]+:/, "").split("::")[0].trim();
    if (withheld.includes(bare)) return refuse(`column ${bare}`);
  }
  return null;
}

function project(row: Record<string, unknown>, list: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of splitSelectList(list)) {
    const embed = parseEmbed(part);
    if (embed) {
      const key = /^([\w]+):/.exec(part)?.[1] ?? embed.table;
      const nested = row[embed.table] ?? row[key];
      out[key] = nested == null ? null : Array.isArray(nested) ? nested.map((n) => project(n as Record<string, unknown>, embed.cols)) : project(nested as Record<string, unknown>, embed.cols);
    } else {
      const col = part.replace(/^[\w]+:/, "").split("::")[0].trim();
      out[col] = row[col];
    }
  }
  return out;
}

const NOOP_METHODS = new Set(["eq", "neq", "in", "is", "not", "or", "gt", "gte", "lt", "lte", "contains", "ilike", "like", "match", "filter", "textSearch", "overlaps", "limit", "range", "abortSignal"]);

export interface GrantsClient {
  from: (table: string) => unknown;
  /** Every query that reached the database layer, with the refusal it got (null when it was allowed). */
  log: Array<{ table: string; select: string; refusal: GrantsError | null }>;
}

export function grantsClient(tables: Record<string, Array<Record<string, unknown>>>): GrantsClient {
  const log: GrantsClient["log"] = [];
  return {
    log,
    from(table: string) {
      const rows = tables[table] ?? [];
      let list: string | undefined;
      let head = false;
      let one: "single" | "maybeSingle" | null = null;
      let filterRefusal: GrantsError | null = null;
      const withheld = WITHHELD[table] ?? [];
      const noteFilter = (column: unknown) => {
        const col = String(column).split(".")[0];
        if (withheld.includes(col)) filterRefusal ??= { code: "42501", message: `permission denied for table ${table} (column ${col} used as a filter)` };
      };
      const settle = () => {
        const refusal = refusalFor(table, list) ?? filterRefusal;
        log.push({ table, select: list ?? "", refusal });
        if (refusal) return { data: null, count: null, error: refusal };
        if (head) return { data: null, count: rows.length, error: null };
        const data = rows.map((r) => (list && list.trim() !== "*" ? project(r, list) : { ...r }));
        if (one) return { data: data[0] ?? null, count: null, error: null };
        return { data, count: rows.length, error: null };
      };
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "select") {
              return (cols?: string, opts?: { head?: boolean }) => {
                list = cols;
                head = !!opts?.head;
                return chain;
              };
            }
            if (prop === "then") return (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(settle()).then(ok, fail);
            if (prop === "single" || prop === "maybeSingle") {
              return () => {
                one = prop;
                return Promise.resolve(settle());
              };
            }
            if (prop === "order") return (column: unknown) => (noteFilter(column), chain);
            if (NOOP_METHODS.has(prop)) {
              return (column?: unknown) => {
                if (typeof column === "string" && prop !== "or" && prop !== "filter") noteFilter(column);
                if (prop === "or" && typeof column === "string") for (const clause of column.split(",")) noteFilter(clause.split(".")[0]);
                return chain;
              };
            }
            throw new Error(`fake-grants-client: unmodelled query method .${prop}()`);
          },
        },
      );
      return chain;
    },
  };
}
