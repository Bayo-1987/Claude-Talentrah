/**
 * JOBS-SHEET-IMPORT-1, PHASE 1: link-out postings from the jobs sheet.
 *
 *   tsx scripts/import-jobs-sheet.ts --csv <Jobs_import_844.csv> --preview <preview.csv> [--existing <fingerprints.txt>]      DRY RUN (the default): writes ONLY the preview file.
 *   tsx scripts/import-jobs-sheet.ts --csv <file> --apply --batch <n>                                                          inserts ONE batch into the database in .env.local
 *   tsx scripts/import-jobs-sheet.ts --undo                                                                                    closes every row of this import (status = closed)
 *   JOBS_IMPORT_PROD_CONFIRM=<csv sha256, first 12>:<batch>:<rows in the batch> tsx scripts/import-jobs-sheet.ts --csv <file> --apply --production --batch <n>
 *   JOBS_IMPORT_PROD_CONFIRM=UNDO:manual-sheet-2026-11-02 tsx scripts/import-jobs-sheet.ts --undo --production
 *
 * WHAT IS IMPORTED. The rows that give a seeker an https APPLY LINK (the link rows and the e-mail rows that also have a link), then the E-MAIL-ONLY rows whose address is one plain address.
 * Every imported row is LINK-OUT (source_type = external), so no Apply button inside Talentrah and no applicant count is ever shown for it, and no button points at "#". A link row has a real
 * external_url and NEVER an apply_email. An e-mail-only row has no external_url and its address, normalised by src/lib/jobs/apply-email.ts, in job_postings.apply_email: the job page
 * shows it only behind "Apply by email" and "Copy address". A row whose address is not one plain address is skipped with a named reason, never repaired. The address is never in the
 * description (scripts/jobs-sheet-import/parse.ts) and never in the preview. The sheet's job-board link is not a column of the CSV and is never read.
 *
 * HOW IT IS SAFE.
 *   - Insert-only: INSERT ... ON CONFLICT (dedup_fingerprint) DO NOTHING. An existing row (the same job already on Talentrah, or an earlier run of this import) is skipped and counted;
 *     nothing is ever updated.
 *   - One import key, `manual-sheet-2026-11-02`: the stale-posting sweep skips `manual-` keys (and closes them on their own expires_at); `--undo` closes exactly this key.
 *   - `llm_enrichment_attempted_at` is set at insert, so the thin-description enricher never adds model-derived tags to these rows.
 *   - Batches: the first batch is a canary of 10, the rest are 50 or fewer; a batch above 50 is refused. One batch per invocation (the operator decides the pause).
 *   - The script never calls the ingest route, the post-ingest refresh, the alert sender or any mailer; the insert raises no notification. Nothing here fetches a web page.
 *   - Without `--production`, `--apply` and `--undo` refuse the production project (scripts/refuse-production.ts), which has no override.
 *   - `--production` is the one guarded way past that, and it asks for all of this at once: the env var JOBS_IMPORT_PROD_CONFIRM equal to "<first 12 characters of the sha256 of the CSV
 *     the script itself reads>:<batch number>:<rows in that batch>" (the script computes the hash; a typed hash alone is never trusted); `--batch N` (mandatory, exactly one batch per
 *     invocation); for N > 1, every fingerprint of batch N-1 already in job_postings under any source (a read-only select), so the canary (batch 1, ten rows) cannot be skipped; a batch
 *     above 50 is refused; service credentials present. The production undo needs `--undo --production` and JOBS_IMPORT_PROD_CONFIRM equal to "UNDO:manual-sheet-2026-11-02", and closes
 *     only that key's open rows. Production mode never prints the project address or a key.
 *   - It prints counts only: never a row, an address or an e-mail.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { extractStructuredJd, inferSeniority, inferWorkType } from "../src/lib/jobs/extract-jd";
import { refuseIfProduction } from "./refuse-production";
import { announceDbTarget } from "./db-target";
import { applyKind, composeDescription, parseDatePosted, parseDeadline, parseSalary, readSheet, splitLocation, type ApplyKind, type SheetRow } from "./jobs-sheet-import/parse";
import { cleanApplyUrl, textNamesBoard } from "./jobs-sheet-import/url";
import { normaliseApplyEmail } from "../src/lib/jobs/apply-email";
import { assignFingerprints } from "./jobs-sheet-import/fingerprint";

export const SOURCE_KEY = "manual-sheet-2026-11-02";
export const MAX_BATCH = 50;
export const CANARY_SIZE = 10;
export const DEFAULT_LIFETIME_DAYS = 30;
export const PROD_CONFIRM_ENV = "JOBS_IMPORT_PROD_CONFIRM";
export const UNDO_CONFIRM = `UNDO:${SOURCE_KEY}`;

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
      seniority: inferSeniority(c.row.title) ?? null,
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
      last_checked_at: now.toISOString(),
      llm_enrichment_attempted_at: now.toISOString(),
      dedup_fingerprint: fp.fingerprint,
    };
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

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
interface UpdateChain {
  eq(column: string, value: string): UpdateChain;
  select(columns: string): Result<Array<{ id: string }>>;
}
/** The two calls the importer makes on a Supabase client, so a test can hand it a fake or a real client. */
export interface ImportClient {
  from(table: "job_postings"): {
    upsert(rows: JobInsert[], options: { onConflict: string; ignoreDuplicates: boolean }): { select(columns: string): Result<Array<{ id: string }>> };
    update(values: Record<string, unknown>): UpdateChain;
    select(columns: string): { in(column: string, values: string[]): Result<Array<{ dedup_fingerprint: string }>> };
  };
}

export interface BatchResult {
  attempted: number;
  inserted: number;
  skippedExisting: number;
}

/** Inserts ONE batch: INSERT ... ON CONFLICT (dedup_fingerprint) DO NOTHING. A batch above 50 is refused before anything is sent. */
export async function insertBatch(client: ImportClient, rows: JobInsert[]): Promise<BatchResult> {
  if (rows.length > MAX_BATCH) throw new Error(`Refusing a batch of ${rows.length}: the limit is ${MAX_BATCH}.`);
  if (rows.length === 0) return { attempted: 0, inserted: 0, skippedExisting: 0 };
  const { data, error } = await client.from("job_postings").upsert(rows, { onConflict: "dedup_fingerprint", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`Insert failed: ${error.message}`);
  const inserted = data?.length ?? 0;
  return { attempted: rows.length, inserted, skippedExisting: rows.length - inserted };
}

/** The undo: closes every OPEN row of this import and no other (status and closed_at only). No hard delete. */
export async function undoImport(client: ImportClient, now: Date = new Date(), key: string = SOURCE_KEY): Promise<{ closed: number }> {
  const { data, error } = await client
    .from("job_postings")
    .update({ status: "closed", closed_at: now.toISOString() })
    .eq("external_source", key)
    .eq("source_type", "external")
    .eq("status", "open")
    .select("id");
  if (error) throw new Error(`Undo failed: ${error.message}`);
  return { closed: data?.length ?? 0 };
}

export interface MainDeps {
  /** A client to use instead of one built from the environment (tests hand in a fake). */
  client?: ImportClient;
  /** The environment to read instead of process.env. */
  env?: Record<string, string | undefined>;
  now?: Date;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The production confirm for one batch: "<first 12 characters of the sha256 of the CSV the script read>:<batch>:<rows in that batch>". The hash is computed here from the file that was
 * actually read; the typed value must agree with it, so a typed value alone is never trusted. Throws, without echoing what was expected, when any part is wrong.
 */
export function checkBatchConfirm(given: string | undefined, csvSha256: string, batch: number, rowsInBatch: number): void {
  const parts = (given ?? "").split(":");
  if (parts.length !== 3) throw new Error(`Production refused: ${PROD_CONFIRM_ENV} must be <first 12 characters of the CSV sha256>:<batch number>:<rows in that batch>.`);
  if (parts[0] !== csvSha256.slice(0, 12)) throw new Error(`Production refused: the CSV hash in ${PROD_CONFIRM_ENV} does not match the file that was read.`);
  if (parts[1] !== String(batch)) throw new Error(`Production refused: the batch number in ${PROD_CONFIRM_ENV} is not the batch asked for.`);
  if (parts[2] !== String(rowsInBatch)) throw new Error(`Production refused: the row count in ${PROD_CONFIRM_ENV} is not the number of rows in that batch.`);
}

/** Batch N > 1 only when every fingerprint of batch N-1 is already in job_postings (any source). A read-only select; the count of rows carrying the key is not used. */
export async function requireEarlierBatchIn(client: ImportClient, plan: Plan, batch: number): Promise<void> {
  if (batch <= 1) return;
  const wanted = batchRows(plan, batch - 1).map((i) => i.insert.dedup_fingerprint);
  const { data, error } = await client.from("job_postings").select("dedup_fingerprint").in("dedup_fingerprint", wanted);
  if (error) throw new Error(`Production refused: could not check that batch ${batch - 1} is in (${error.message}).`);
  const present = new Set((data ?? []).map((r) => r.dedup_fingerprint));
  const missing = wanted.filter((f) => !present.has(f)).length;
  if (missing > 0) throw new Error(`Production refused: batch ${batch - 1} is not fully in (${wanted.length - missing} of ${wanted.length} present). Run the earlier batches first, starting with the canary (batch 1).`);
}

function productionClient(deps: MainDeps): ImportClient {
  if (deps.client) return deps.client;
  const env = deps.env ?? process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Production refused: the service credentials are not set.");
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as ImportClient;
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function serviceClient(): ImportClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  announceDbTarget("import-jobs-sheet");
  refuseIfProduction("import-jobs-sheet", url);
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as ImportClient;
}

export async function main(args: string[], deps: MainDeps = {}): Promise<void> {
  const csvPath = argValue(args, "--csv");
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const production = args.includes("--production");
  const apply = args.includes("--apply");
  const undo = args.includes("--undo");
  if (production && apply === undo) throw new Error("Production refused: --production goes with exactly one of --apply and --undo.");
  if (undo) {
    if (production) {
      if (env[PROD_CONFIRM_ENV] !== UNDO_CONFIRM) throw new Error(`Production refused: ${PROD_CONFIRM_ENV} is not the undo confirm.`);
      const { closed } = await undoImport(productionClient(deps), now);
      console.log(`Production undo: closed ${closed}.`);
      return;
    }
    const { closed } = await undoImport(serviceClient(), now);
    console.log(`Undo: closed ${closed} open row(s) of ${SOURCE_KEY}.`);
    return;
  }
  if (!csvPath) throw new Error("Pass --csv <file>.");
  const existingPath = argValue(args, "--existing");
  const existing = existingPath ? new Set(readFileSync(existingPath, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) : undefined;
  const csvBytes = readFileSync(csvPath);
  const plan = buildPlan(csvBytes.toString("utf8"), { now, existingFingerprints: existing });
  const c = plan.counts;
  console.log(`Rows ${c.rows}; importable ${c.importable} in ${c.batches} batch(es); skipped ${c.rows - c.importable}.`);
  for (const [reason, n] of Object.entries(c.skippedByReason).sort()) console.log(`  skipped ${n}: ${reason}`);
  if (!existing) console.log("  not checked here: rows already on Talentrah (no --existing file); the database skips them at insert and the batch result counts them.");

  if (!apply) {
    const previewPath = argValue(args, "--preview");
    if (!previewPath) throw new Error("Dry run: pass --preview <file>. Nothing else is written.");
    writeFileSync(previewPath, renderPreview(plan));
    console.log("Dry run: wrote the preview file only; no database was contacted.");
    return;
  }
  const batch = Number(argValue(args, "--batch"));
  if (!Number.isInteger(batch) || batch < 1 || batch > c.batches) throw new Error(`Pass --batch <1..${c.batches}> (batch 1 is the canary of ${CANARY_SIZE}).`);
  const rows = batchRows(plan, batch);
  if (!production) {
    const result = await insertBatch(serviceClient(), rows.map((i) => i.insert));
    console.log(`Batch ${batch}: attempted ${result.attempted}, inserted ${result.inserted}, skipped as already present ${result.skippedExisting}.`);
    return;
  }
  checkBatchConfirm(env[PROD_CONFIRM_ENV], sha256Hex(csvBytes), batch, rows.length);
  const client = productionClient(deps);
  await requireEarlierBatchIn(client, plan, batch);
  const result = await insertBatch(client, rows.map((i) => i.insert));
  console.log(`Production batch ${batch}: attempted ${result.attempted}, inserted ${result.inserted}, skipped as already present ${result.skippedExisting}.`);
}

// Run only when this file is the program (`tsx scripts/import-jobs-sheet.ts`); importing it, as the tests do, runs nothing.
if (/[\\/]import-jobs-sheet\.ts$/.test(process.argv[1] ?? "")) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
