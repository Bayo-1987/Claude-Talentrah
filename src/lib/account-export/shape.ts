import { MANIFEST_BY_TABLE, type ColumnClass, type ExportTable } from "./manifest";

/**
 * ACCT-1 PR 2a: turns one database row into one row of the file, by the manifest's classes. Pure: no database, no clock, no network, so every rule
 * the owner set (masked bank details, other parties reduced to a role or a first name, no contact details, no secrets) is tested on plain objects.
 */

export type Row = Record<string, unknown>;

/** What shaping a row needs to know that the row does not say. */
export interface ShapeContext {
  userId: string;
  /** Another person's first name by profile id (only ever read for columns classed `party:...:name`). */
  firstNames: ReadonlyMap<string, string>;
  /** A bank code's name, or undefined when the provider's list could not be read. */
  bankNames: ReadonlyMap<string, string>;
}

/* ── bank details: the ONE place the masking rule lives ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The owner's rule (6 Oct 2026, confirmed with the lawyer): the self-service file carries the bank NAME and the LAST FOUR digits of the account number,
 * with a line in the README saying full details are available on a verified request to support. Change the rule here and nowhere else.
 */
export function maskBankDetails(accountNumber: unknown): string | null {
  if (typeof accountNumber !== "string") return null;
  const digits = accountNumber.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/* ── contact details typed into somebody's note ───────────────────────────────────────────────────────────────────────────────────────────────── */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PHONE = /(?<![\w])\+?\d[\d\s().-]{6,}\d(?![\w])/g;
const HANDLE = /(^|[\s(])@[A-Za-z0-9_.]{2,}/g;
const URL_WITH_PROFILE = /https?:\/\/[^\s]+/g;

/** An email address, a telephone number, an @handle or a link inside free text is somebody's contact detail; the text keeps its words and loses those. */
export function maskContactDetails(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(URL_WITH_PROFILE, "[link removed]")
    .replace(PHONE, (candidate) => {
      const digits = candidate.replace(/\D/g, "").length;
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate.trim());
      // A telephone number is nine or more digits (seven with a leading +); a date, a price or a count is not one.
      return !isDate && (digits >= 9 || (candidate.trim().startsWith("+") && digits >= 7)) ? "[number removed]" : candidate;
    })
    .replace(HANDLE, "$1[handle removed]");
}

/* ── one row ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const EXPORTED_CLASSES = new Set<ColumnClass["kind"]>(["include", "own-contact", "bank-name", "bank-last-four", "side", "party"]);

/** The columns to ask the database for: every column whose class puts something in the file, and nothing else. Never `*`. */
export function selectColumns(spec: ExportTable): string[] {
  return Object.entries(spec.columns)
    .filter(([, c]) => EXPORTED_CLASSES.has(c.kind))
    .map(([name]) => name)
    .sort();
}

/** The profile ids whose first name a row set needs: the other person in each `party:...:name` column. */
export function firstNameIds(spec: ExportTable, rows: readonly Row[], userId: string): string[] {
  const ids = new Set<string>();
  for (const [name, c] of Object.entries(spec.columns)) {
    if (c.kind !== "party" || !c.firstName) continue;
    for (const row of rows) {
      const v = row[name];
      if (typeof v === "string" && v !== userId) ids.add(v);
    }
  }
  return [...ids];
}

/** The bank codes of a row set, for the one lookup that turns them into names. */
export function bankCodes(spec: ExportTable, rows: readonly Row[]): string[] {
  const codes = new Set<string>();
  for (const [name, c] of Object.entries(spec.columns)) {
    if (c.kind !== "bank-name") continue;
    for (const row of rows) if (typeof row[name] === "string" && row[name]) codes.add(row[name] as string);
  }
  return [...codes];
}

function partyOutput(name: string, c: Extract<ColumnClass, { kind: "party" }>, value: unknown, ctx: ShapeContext, out: Row): void {
  const base = name.replace(/_id$/, "");
  if (typeof value === "string" && value === ctx.userId) {
    out[`${base}_is_you`] = true;
    return;
  }
  if (value === null || value === undefined) return;
  out[`${base}_role`] = c.role;
  if (c.firstName) {
    const first = typeof value === "string" ? ctx.firstNames.get(value) : undefined;
    out[`${base}_first_name`] = first && first.trim() ? first.trim() : null;
  }
}

/** One row of the file. Columns that are not exported, and columns the manifest does not know, are not in it. */
export function shapeRow(table: string, row: Row, ctx: ShapeContext): Row {
  const spec = MANIFEST_BY_TABLE.get(table);
  if (!spec) throw new Error(`account export: ${table} is not in the manifest`);
  const out: Row = {};
  for (const [name, value] of Object.entries(row)) {
    const c = spec.columns[name];
    if (!c) continue;
    switch (c.kind) {
      case "include":
      case "own-contact":
        out[name] = value;
        break;
      case "bank-name": {
        const bankName = typeof value === "string" ? ctx.bankNames.get(value) : undefined;
        out.payout_bank_name = bankName ?? null;
        // The code is public provider data, not a secret: it is shown only when the name could not be looked up, so the line is never empty.
        if (!bankName && typeof value === "string") out.payout_bank_code = value;
        break;
      }
      case "bank-last-four":
        out.payout_account_last_four = maskBankDetails(value);
        break;
      case "side":
        if (row[c.column] === ctx.userId) out[name] = c.text && typeof value === "string" ? maskContactDetails(value) : value;
        break;
      case "party":
        partyOutput(name, c, value, ctx, out);
        break;
      default:
        break; // never, other-party, internal
    }
  }
  return out;
}
