import { exportChunks, type BuildStats } from "@/lib/account-export/build";
import { fakeExportDb, type FakeExportDb, type FakeRow } from "./fake-export-db";
import { fixtureTables } from "./export-fixtures";

export interface ExportRun {
  text: string;
  file: { _readme: string; generated_at: string; tables: Record<string, Array<Record<string, unknown>>> };
  db: FakeExportDb;
  stats: BuildStats;
}

/** Builds the whole file for `userId` from the fixture tables and parses it. `text` is the exact bytes a person would download. */
export async function runExport(userId: string, opts: { tables?: Record<string, FakeRow[]>; bankNames?: Map<string, string> | "fail"; pageSize?: number } = {}): Promise<ExportRun> {
  const db = fakeExportDb(opts.tables ?? fixtureTables());
  const stats: BuildStats = { tables: 0, rows: 0 };
  let text = "";
  for await (const piece of exportChunks(
    {
      client: db as never,
      userId,
      now: new Date("2026-10-06T14:00:00.000Z"),
      supportUrl: "https://talentrah.test/contact",
      pageSize: opts.pageSize,
      loadBankNames: async () => {
        if (opts.bankNames === "fail") throw new Error("provider unreachable");
        return opts.bankNames ?? new Map([["058", "Access Bank"]]);
      },
    },
    stats,
  )) {
    text += piece;
  }
  return { text, file: JSON.parse(text), db, stats };
}
