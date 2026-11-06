/**
 * Shared fixtures for the admin jobs uploader tests (PR-U1): a SYNTHETIC sheet (no real address, phone or link; every address ends in example.test, every link is on careers.example.test),
 * fake dependencies, and a form-post helper. No module is mocked: the handlers take their dependencies as arguments.
 */
import { createHash } from "node:crypto";
import type { HandlerDeps } from "@/lib/jobs/sheet-import/handlers";
import type { ImportAudit } from "@/lib/jobs/sheet-import/constants";

export const HEADER = ["id", "origin", "method", "title", "company", "location", "salary", "date_posted", "deadline", "summary", "description", "requirements", "qualifications", "apply_email", "apply_phone", "apply_link", "apply_text"];
export type Cells = Partial<Record<(typeof HEADER)[number], string>>;
export const NOW = new Date("2026-11-05T12:00:00Z");
export const ORIGIN = "https://admin.example.test";

let seq = 0;
export function cells(over: Cells = {}): Cells {
  seq++;
  return {
    id: String(seq), origin: "recheck", method: "Link", title: `Synthetic Role ${seq}`, company: `Synthetic Co ${seq}`, location: "Lagos", salary: "", date_posted: "2 Nov 2026", deadline: "",
    summary: `Summary text ${seq}.`, description: "", requirements: "", qualifications: "", apply_email: "", apply_phone: "", apply_link: `https://careers.example.test/jobs/${seq}`,
    apply_text: `Apply at the link ${seq}.`, ...over,
  };
}
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
export function csv(rows: Cells[], header: string[] = HEADER): string {
  return [header.join(","), ...rows.map((r) => header.map((h) => quote((r as Record<string, string>)[h] ?? "")).join(","))].join("\r\n") + "\r\n";
}
export const linkRow = (over: Cells = {}) => cells({ method: "Link", ...over });
export const emailPlusLink = (n = 1, over: Cells = {}) => cells({ method: "Email", apply_email: `both${n}@example.test`, apply_text: `Send your CV to both${n}@example.test or use the link.`, ...over });
export const emailOnly = (n = 1, over: Cells = {}) => cells({ method: "Email", apply_link: "", apply_email: `hr${n}@example.test`, apply_text: `Email hr${n}@example.test.`, ...over });

/** Every string that must never appear in a response, an audit row or a log line. */
export const FIXTURE_ADDRESSES = ["hr1@example.test", "hr2@example.test", "hr3@example.test", "both1@example.test", "careers.example.test", "08000000000"];

export function sheetOf(n: { link?: number; both?: number; email?: number } = {}): string {
  const rows: Cells[] = [];
  for (let i = 0; i < (n.link ?? 0); i++) rows.push(linkRow({ apply_phone: i === 0 ? "08000000000" : "" }));
  for (let i = 0; i < (n.both ?? 0); i++) rows.push(emailPlusLink(i + 1));
  for (let i = 0; i < (n.email ?? 0); i++) rows.push(emailOnly(i + 1));
  return csv(rows);
}
export const sha12 = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

export interface Order {
  events: string[];
}

export interface AuditCall {
  kind: "denied" | "requested" | "finished";
  detail: Record<string, unknown>;
}

export function fakeAudit(order: Order, opts: { requestedFails?: boolean } = {}): ImportAudit & { calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  return {
    calls,
    async denied(_admin, detail) {
      order.events.push("audit:denied");
      calls.push({ kind: "denied", detail });
    },
    async requested(_admin, detail) {
      if (opts.requestedFails) throw new Error("audit unavailable");
      order.events.push("audit:requested");
      calls.push({ kind: "requested", detail });
      return "audit-row-1";
    },
    async finished(_admin, detail) {
      order.events.push("audit:finished");
      calls.push({ kind: "finished", detail });
    },
  };
}

/** A fake job_postings table: insert-only upsert that skips a known fingerprint, a read of known fingerprints, and an optional failure on the Nth write. */
export class FakeDb {
  rows = new Map<string, Record<string, unknown>>();
  upserts: { rows: Record<string, unknown>[]; options: unknown }[] = [];
  selects: string[][] = [];
  updates = 0;
  failOnWrite: number | null = null;
  failMessage = "insert failed";
  constructor(private order: Order) {}
  from(table: string) {
    if (table !== "job_postings") throw new Error(`unexpected table ${table}`);
    return {
      upsert: (rows: Record<string, unknown>[], options: unknown) => ({
        select: async () => {
          this.order.events.push("write");
          this.upserts.push({ rows, options });
          if (this.failOnWrite !== null && this.upserts.length === this.failOnWrite) return { data: null, error: { message: this.failMessage, code: "23514" } };
          const added = rows.filter((r) => !this.rows.has(r.dedup_fingerprint as string));
          for (const r of added) this.rows.set(r.dedup_fingerprint as string, r);
          return { data: added.map((_, i) => ({ id: `id-${this.rows.size}-${i}` })), error: null };
        },
      }),
      select: () => ({
        in: async (_c: string, values: string[]) => {
          this.selects.push(values);
          return { data: values.filter((v) => this.rows.has(v)).map((v) => ({ dedup_fingerprint: v })), error: null };
        },
      }),
      update: () => {
        this.updates++;
        throw new Error("the uploader never updates a posting");
      },
    };
  }
}

export const ADMIN = { adminId: "admin-1", email: "operator@example.test", sessionId: "session-1", permissions: ["jobs_import"] as string[] };

export function makeDeps(over: Partial<HandlerDeps> = {}, order: Order = { events: [] }): { deps: HandlerDeps; db: FakeDb; audit: ReturnType<typeof fakeAudit>; order: Order; logged: string[] } {
  const db = new FakeDb(order);
  const audit = fakeAudit(order);
  const logged: string[] = [];
  const deps: HandlerDeps = {
    getAdmin: async () => ADMIN,
    audit,
    service: () => db as never,
    now: () => NOW,
    log: (c) => void logged.push(c),
    ...over,
  };
  return { deps, db, audit, order, logged };
}

export function formRequest(path: "preview" | "confirm", file: string | Uint8Array | null, fields: Record<string, string> = {}, init: { origin?: string | null; contentLength?: number } = {}): Request {
  const form = new FormData();
  if (file !== null) form.set("file", new File([file as BlobPart], "jobs.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const headers = new Headers();
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.contentLength !== undefined) headers.set("content-length", String(init.contentLength));
  return new Request(`${ORIGIN}/admin/jobs-import/${path}`, { method: "POST", headers, body: form });
}
