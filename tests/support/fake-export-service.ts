/**
 * A service-role client double for generateExport: the data tables come from fakeExportDb, and the three SQL functions of migration 0214 are modelled with
 * the SAME rules the SQL has (the 3-a-day limit that ignores failed exports, a verified code that is valid for ten minutes and consumed by the claim,
 * five wrong tries). The real SQL is exercised against a real Postgres by tests/rls/account-data-export.test.ts (CI) and was run against the replayed migrations
 * locally; this double exists so the route's own logic (the order of its steps) is tested without one.
 */
import { fakeExportDb, type FakeExportDb, type FakeRow } from "./fake-export-db";

export interface ExportRow {
  id: string;
  user_id: string;
  requested_at: Date;
  status: "started" | "completed" | "failed";
  bytes: number | null;
  tables: number | null;
}

export interface CodeRow {
  hash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export class FakeExportService {
  db: FakeExportDb;
  exports: ExportRow[] = [];
  codes: CodeRow[] = [];
  now: () => Date;
  calls: string[] = [];
  private seq = 0;

  constructor(tables: Record<string, FakeRow[]>, now: () => Date) {
    this.db = fakeExportDb(tables);
    this.now = now;
  }

  from = (table: string) => {
    this.calls.push(`from:${table}`);
    if (table === "account_data_exports") {
      return {
        update: (v: Record<string, unknown>) => ({
          eq: async (_c: string, id: string) => {
            const row = this.exports.find((e) => e.id === id);
            if (row) Object.assign(row, { status: v.status, bytes: v.bytes, tables: v.table_count });
            return { error: null };
          },
        }),
      };
    }
    return this.db.from(table);
  };

  rpc = async (fn: string, args: Record<string, unknown>) => {
    this.calls.push(`rpc:${fn}`);
    const userId = String(args.p_user_id);
    const now = this.now();
    if (fn === "account_export_issue_code") {
      for (const c of this.codes) if (!c.consumedAt) c.consumedAt = now;
      this.codes.push({ hash: String(args.p_code_hash), attempts: 0, expiresAt: new Date(now.getTime() + 15 * 60_000), verifiedAt: null, consumedAt: null });
      return { data: null, error: null };
    }
    if (fn === "account_export_verify_code") {
      const c = [...this.codes].reverse().find((x) => !x.consumedAt);
      if (!c) return { data: "none", error: null };
      if (c.expiresAt < now) return { data: "expired", error: null };
      if (c.attempts >= 5) return { data: "locked", error: null };
      if (c.hash === args.p_code_hash) {
        c.verifiedAt = now;
        return { data: "ok", error: null };
      }
      c.attempts++;
      return { data: c.attempts >= 5 ? "locked" : "wrong", error: null };
    }
    if (fn === "claim_account_data_export") {
      const since = now.getTime() - 24 * 3600_000;
      const used = this.exports.filter((e) => e.user_id === userId && e.requested_at.getTime() > since && e.status !== "failed").length;
      if (used >= 3) return { data: [{ ok: false, export_id: null, reason: "rate_limited" }], error: null };
      if (args.p_use_code) {
        const c = this.codes.find((x) => x.verifiedAt && !x.consumedAt && x.verifiedAt.getTime() > now.getTime() - 10 * 60_000);
        if (!c) return { data: [{ ok: false, export_id: null, reason: "code_required" }], error: null };
        c.consumedAt = now;
      }
      const id = `export-${++this.seq}`;
      this.exports.push({ id, user_id: userId, requested_at: now, status: "started", bytes: null, tables: null });
      return { data: [{ ok: true, export_id: id, reason: null }], error: null };
    }
    throw new Error(`fake-export-service: unmodelled rpc ${fn}`);
  };
}
