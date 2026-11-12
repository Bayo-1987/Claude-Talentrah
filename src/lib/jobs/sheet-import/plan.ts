/**
 * The plan of a jobs sheet: the pure part of the jobs-sheet import (JOBS-SHEET-IMPORT-1, with E3's e-mail-only rows), shared by the operator script (scripts/import-jobs-sheet.ts) and the
 * admin uploader (src/lib/jobs/sheet-import/upload.ts). Reads nothing but the CSV text it is given, writes nothing, contacts nothing. The rules are exactly the script's: link rows and
 * e-mail-plus-link rows have a real external_url and NEVER an apply_email; an e-mail-only row has no external_url and its normalised address in apply_email, or is skipped as "email address is
 * not one plain address"; the address is never in the description (parse.ts) and never in the preview (renderPreview).
 */
import { extractStructuredJd, inferJobSeniority, inferWorkType } from "@/lib/jobs/extract-jd";
import { isLinkOutPosting } from "@/lib/jobs/link-out";
import { normaliseApplyEmail } from "@/lib/jobs/apply-email";
import { applyKind, composeDescription, parseDatePosted, parseDeadline, parseSalary, readSheet, splitLocation, type ApplyKind, type SheetRow } from "./parse";
import { cleanApplyUrl, textNamesBoard } from "./url";
import { assignFingerprints } from "./fingerprint";

export const SOURCE_KEY = "manual-sheet-2026-11-02";
export const MAX_BATCH = 50;
export const CANARY_SIZE = 10;
export const DEFAULT_LIFETIME_DAYS = 30;

export interface JobInsert {
  source_type: "external";
  organization_id: null;
  title: string;
  company_name: string;
  location: string | null;
  description: string;
  structured_jd: unknown;
  seniority: string | null;
  work_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_unit: string | null;
  /** null for an e-mail-only row (the address is in apply_email instead). */
  external_url: string | null;
  /** Present ONLY on an e-mail-only row: the normalised address. A row with an apply link has no apply_email key at all. */
  apply_email?: string;
  external_source: string;
  status: "open";
  posted_at: string;
  expires_at: string;
  /** 'stated' only when the sheet gave a deadline; the 30-day lifetime applied otherwise is 'default' (0278). */
  expires_at_source: "stated" | "default";
  last_checked_at: string;
  llm_enrichment_attempted_at: string;
  dedup_fingerprint: string;
}

export interface PreviewLine {
  title: string;
  company: string;
  kind: ApplyKind;
  applyMethodType: string;
  externalKey: string;
  batch: number | null;
  skipReason: string;
}

export interface PlanItem {
  line: number;
  insert: JobInsert;
  preview: PreviewLine;
  batch: number;
}

export interface Plan {
  /** Importable rows in import order (link rows, then e-mail-plus-link rows, then e-mail-only rows), each with its batch number. */
  items: PlanItem[];
  /** One preview line per CSV row, in file order (importable rows carry their batch, skipped rows their reason). */
  preview: PreviewLine[];
  counts: { rows: number; importable: number; batches: number; skippedByReason: Record<string, number> };
}

export interface PlanOptions {
  now: Date;
  /** The import key stored in external_source. Always SOURCE_KEY in a real run; a test passes its own so it can never touch a real import's rows. */
  sourceKey?: string;
  /** Fingerprints already on Talentrah (a read-only export), if the operator has one. Rows that match are skipped with a reason; without it this check is made by the database at insert time. */
  existingFingerprints?: ReadonlySet<string>;
}

const REASON_EMAIL_INVALID = "email address is not one plain address";
const REASON_NO_WAY = "no way to apply";
const REASON_NO_TITLE = "missing title or company";
const REASON_BOARD_TEXT = "job-board address in the text";
const REASON_DEADLINE = "deadline already passed";
const REASON_DUPLICATE = "duplicate of an earlier row in this import";
const REASON_EXISTING = "already on Talentrah (same fingerprint)";

function previewOf(row: SheetRow, kind: ApplyKind, skipReason: string, externalKey = "", batch: number | null = null): PreviewLine {
  return { title: row.title, company: row.company, kind, applyMethodType: kind === "link" || kind === "email+link" ? "link" : kind, externalKey, batch, skipReason };
}

/** Pure: the whole plan from the CSV text. Reads nothing else, writes nothing. */
export function buildPlan(csvText: string, options: PlanOptions): Plan {
  const rows = readSheet(csvText);
  const now = options.now;
  const sourceKey = options.sourceKey ?? SOURCE_KEY;
  const preview: Array<PreviewLine | null> = rows.map(() => null);
  type Candidate = { index: number; row: SheetRow; kind: ApplyKind; url: string | null; applyEmail: string | null; location: string | null; rest: string[]; description: string; deadline: Date | null; salary: ReturnType<typeof parseSalary> };
  const candidates: Candidate[] = [];

  rows.forEach((row, index) => {
    const kind = applyKind(row);
    if (row.title === "" || row.company === "") return void (preview[index] = previewOf(row, kind, REASON_NO_TITLE));
    if (kind !== "link" && kind !== "email+link" && kind !== "email") return void (preview[index] = previewOf(row, kind, REASON_NO_WAY));
    // An e-mail-only row is built from its address; a row with a link is built from the link and never carries an address.
    let url: string | null = null;
    let applyEmail: string | null = null;
    if (kind === "email") {
      applyEmail = normaliseApplyEmail(row.applyEmail);
      if (applyEmail === null) return void (preview[index] = previewOf(row, kind, REASON_EMAIL_INVALID));
    } else {
      const verdict = cleanApplyUrl(row.applyLink);
      if (!verdict.ok) return void (preview[index] = previewOf(row, kind, `link rejected: ${verdict.reason}`));
      url = verdict.url;
    }
    const { first, rest } = splitLocation(row.location);
    const salary = parseSalary(row.salary);
    const description = composeDescription(row, rest, salary !== null);
    if ([row.title, row.company, description].some(textNamesBoard)) return void (preview[index] = previewOf(row, kind, REASON_BOARD_TEXT));
    const deadline = parseDeadline(row.deadline);
    if (deadline && deadline.getTime() < now.getTime()) return void (preview[index] = previewOf(row, kind, REASON_DEADLINE));
    candidates.push({ index, row, kind, url, applyEmail, location: first, rest, description, deadline, salary });
  });

  // Link rows first, then the e-mail-plus-link rows, then the e-mail-only rows (so the canary and the earlier batches never change); file order inside each group.
  const ordered = [...candidates.filter((c) => c.kind === "link"), ...candidates.filter((c) => c.kind === "email+link"), ...candidates.filter((c) => c.kind === "email")];
  // The apply key only tells two requisitions of one company, title and place apart: the link, or for an e-mail-only row its address (hashed by the fingerprint, stored nowhere).
  const fingerprints = assignFingerprints(ordered.map((c) => ({ company: c.row.company, title: c.row.title, location: c.location, applyKey: c.url ?? `mailto:${c.applyEmail}` })));

  const items: PlanItem[] = [];
  ordered.forEach((c, i) => {
    const fp = fingerprints[i];
    if (fp.fingerprint === null) return void (preview[c.index] = previewOf(c.row, c.kind, REASON_DUPLICATE));
    if (options.existingFingerprints?.has(fp.fingerprint)) return void (preview[c.index] = previewOf(c.row, c.kind, REASON_EXISTING, `${sourceKey}:${fp.fingerprint.slice(0, 12)}`));
    const position = items.length;
    const batch = position < CANARY_SIZE ? 1 : 2 + Math.floor((position - CANARY_SIZE) / MAX_BATCH);
    const postedAt = parseDatePosted(c.row.datePosted) ?? now;
    const expiresAt = c.deadline ?? new Date(now.getTime() + DEFAULT_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
    const insert: JobInsert = {
      source_type: "external",
      organization_id: null,
      title: c.row.title,
      company_name: c.row.company,
      location: c.location,
      description: c.description,
      structured_jd: extractStructuredJd(c.description),
      // A POSTING's seniority is unknown when its title is silent (S12 (e), tests/jobs/seniority-adapters-use-job-inference.test.ts): the defaulting inferSeniority is for a candidate's own title only.
      seniority: inferJobSeniority(c.row.title) ?? null,
      work_type: inferWorkType(c.row.title, c.location ?? undefined) ?? null,
      salary_min: c.salary?.min ?? null,
      salary_max: c.salary?.max ?? null,
      salary_currency: c.salary?.currency ?? null,
      salary_unit: c.salary?.unit ?? null,
      external_url: c.url,
      ...(c.applyEmail === null ? {} : { apply_email: c.applyEmail }),
      external_source: sourceKey,
      status: "open",
      posted_at: postedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      expires_at_source: c.deadline ? "stated" : "default",
      last_checked_at: now.toISOString(),
      llm_enrichment_attempted_at: now.toISOString(),
      dedup_fingerprint: fp.fingerprint,
    };
    // Every imported row is LINK-OUT (an external posting): no Apply button inside Talentrah, no applicant count. The shared predicate is the one definition of that.
    if (!isLinkOutPosting(insert)) throw new Error("The sheet import built a row that is not link-out.");
    const line = previewOf(c.row, c.kind, "", `${sourceKey}:${fp.fingerprint.slice(0, 12)}`, batch);
    preview[c.index] = line;
    items.push({ line: c.row.line, insert, preview: line, batch });
  });

  const lines = preview.map((p, i) => p ?? previewOf(rows[i], applyKind(rows[i]), "not planned"));
  const skippedByReason: Record<string, number> = {};
  for (const l of lines) if (l.skipReason !== "") skippedByReason[l.skipReason] = (skippedByReason[l.skipReason] ?? 0) + 1;
  return { items, preview: lines, counts: { rows: rows.length, importable: items.length, batches: items.length === 0 ? 0 : Math.max(...items.map((x) => x.batch)), skippedByReason } };
}

export function batchRows(plan: Plan, batch: number): PlanItem[] {
  return plan.items.filter((i) => i.batch === batch);
}

/** The preview file: title, company, kind, apply_method_type, external_key, batch, skip_reason. No address, no e-mail, no phone, no job-board link. */
export function renderPreview(plan: Plan): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = "title,company,kind,apply_method_type,external_key,batch,skip_reason";
  const body = plan.preview.map((p) => [p.title, p.company, p.kind, p.applyMethodType, p.externalKey, p.batch, p.skipReason].map(esc).join(","));
  return `${[head, ...body].join("\n")}\n`;
}
