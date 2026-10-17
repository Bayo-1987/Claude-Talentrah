import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { EXPORT_MANIFEST, type ExportTable } from "./manifest";
import { buildReadme } from "./readme";
import { bankCodes, firstNameIds, selectColumns, shapeRow, type Row, type ShapeContext } from "./shape";

/**
 * ACCT-1 PR 2a: reads the person's rows table by table and yields the file as JSON text, in pieces, so no table has to fit in memory at once and the
 * response can start before the last table is read (a streamed response is not subject to a platform's body-size limit).
 *
 * Every query names its columns (`selectColumns`, never `*`) and filters on the owner column(s) with the id the SESSION gave: there is no parameter that
 * could name another person. The service role is used because several columns the person is entitled to (their notes on a session, their payout amounts)
 * are withheld from the signed-in role by the column grants (0224/0225/0231); the manifest, not the grants, decides what the file holds.
 *
 * A table that cannot be read ABORTS the file (the error propagates and the stream is errored), so a person never receives a file that quietly lacks a table.
 */

type Client = SupabaseClient<Database>;

export interface BuildDeps {
  client: Client;
  userId: string;
  now: Date;
  /** The bank-name lookup (the provider's list). Called at most once, and only when a payout bank code exists. A failure shows the code instead of the name. */
  loadBankNames: () => Promise<ReadonlyMap<string, string>>;
  supportUrl: string;
  pageSize?: number;
  /** Which tables to read; defaults to the whole manifest. */
  tables?: readonly ExportTable[];
}

export interface BuildStats {
  tables: number;
  rows: number;
}

const FIRST_NAME_CHUNK = 200;
const DEFAULT_PAGE = 1000;

type Query = {
  select: (cols: string) => Query;
  eq: (col: string, v: string) => Query;
  or: (expr: string) => Query;
  in: (col: string, v: string[]) => Query;
  order: (col: string, o: { ascending: boolean }) => Query;
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
};

const from = (client: Client, table: string): Query => (client as unknown as { from: (t: string) => Query }).from(table);

async function readFirstNames(client: Client, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += FIRST_NAME_CHUNK) {
    const chunk = ids.slice(i, i + FIRST_NAME_CHUNK);
    const { data, error } = await (from(client, "profiles").select("id, first_name").in("id", chunk).order("id", { ascending: true }).range(0, FIRST_NAME_CHUNK - 1));
    if (error) throw new Error(`could not read first names: ${error.message}`);
    for (const r of data ?? []) if (typeof r.id === "string" && typeof r.first_name === "string") out.set(r.id, r.first_name);
  }
  return out;
}

/** The pieces of the file, in order. `stats` is filled as it goes and complete once the iterator has finished. */
export async function* exportChunks(deps: BuildDeps, stats: BuildStats = { tables: 0, rows: 0 }): AsyncGenerator<string> {
  const { client, userId, now } = deps;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE;
  // A table with no exported column (throttle counters) is not read at all.
  const tables = (deps.tables ?? EXPORT_MANIFEST).filter((t) => selectColumns(t).length > 0);
  let bankNames: ReadonlyMap<string, string> | null = null;

  yield `{"_readme":${JSON.stringify(buildReadme({ generatedAt: now, supportUrl: deps.supportUrl }))},"generated_at":${JSON.stringify(now.toISOString())},"tables":{`;

  let firstTable = true;
  for (const spec of tables) {
    const columns = selectColumns(spec).join(", ");
    yield `${firstTable ? "" : ","}${JSON.stringify(spec.table)}:[`;
    firstTable = false;
    let firstRow = true;
    for (let offset = 0; ; offset += pageSize) {
      let q = from(client, spec.table).select(columns);
      q = spec.owner.length === 1 ? q.eq(spec.owner[0], userId) : q.or(spec.owner.map((c) => `${c}.eq.${userId}`).join(","));
      const { data, error } = await q.order(spec.orderBy, { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw new Error(`could not read ${spec.table}: ${error.message}`);
      const rows = data ?? [];
      if (rows.length === 0) break;

      const codes = bankCodes(spec, rows);
      if (codes.length > 0 && bankNames === null) {
        try {
          bankNames = await deps.loadBankNames();
        } catch {
          bankNames = new Map();
        }
      }
      const ids = firstNameIds(spec, rows, userId);
      const ctx: ShapeContext = { userId, firstNames: ids.length ? await readFirstNames(client, ids) : new Map(), bankNames: bankNames ?? new Map() };

      for (const row of rows) {
        yield `${firstRow ? "" : ","}${JSON.stringify(shapeRow(spec.table, row, ctx))}`;
        firstRow = false;
        stats.rows++;
      }
      if (rows.length < pageSize) break;
    }
    yield "]";
    stats.tables++;
  }
  yield "}}";
}
