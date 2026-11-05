import { createHash } from "node:crypto";
import { buildPlan, renderPreview, type Plan } from "./plan";
import { REQUIRED_COLUMNS, cleanText, parseCsv } from "./parse";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, PREVIEW_LINE_LIMIT, uploadSourceKey } from "./limits";
import { readExistingFingerprints, type ImportWriteClient } from "./write";

/**
 * The uploader's two operations on the bytes of a sheet (PR-U1): inspect them against the limits, and plan them with the database's existing fingerprints. Both are used by the preview
 * (which writes nothing) and by the confirm (which recomputes the same plan itself, so nothing the client sends decides what is written).
 */
export type Inspected = { ok: true; text: string; sha256: string } | { ok: false; status: 400 | 413; code: "empty" | "not_csv" | "too_large" | "too_many_rows" | "missing_columns"; columns?: string[] };

/** The limits and the header, before any row is planned. Never quotes a cell. */
export function inspectUpload(bytes: Uint8Array): Inspected {
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, status: 413, code: "too_large" };
  if (bytes.length === 0) return { ok: false, status: 400, code: "empty" };
  if (bytes.includes(0)) return { ok: false, status: 400, code: "not_csv" };
  const text = new TextDecoder("utf-8").decode(bytes);
  const records = parseCsv(text);
  if (records.length === 0) return { ok: false, status: 400, code: "empty" };
  const header = records[0].map((h) => cleanText(h));
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) return { ok: false, status: 400, code: "missing_columns", columns: [...missing] };
  if (records.length - 1 > MAX_UPLOAD_ROWS) return { ok: false, status: 413, code: "too_many_rows" };
  return { ok: true, text, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export type Planned = { ok: true; plan: Plan; sourceKey: string; sha12: string } | { ok: false; errorClass: string };

/** The whole plan: the sheet's own rules, then the fingerprints already on Talentrah (a read-only select) so a known job is a counted skip, not a write. */
export async function planUpload(inspected: { text: string; sha256: string }, now: Date, client: ImportWriteClient): Promise<Planned> {
  const sourceKey = uploadSourceKey(now, inspected.sha256);
  const first = buildPlan(inspected.text, { now, sourceKey });
  const wanted = first.items.map((i) => i.insert.dedup_fingerprint);
  let plan = first;
  if (wanted.length > 0) {
    const read = await readExistingFingerprints(client, wanted);
    if (!read.ok) return { ok: false, errorClass: read.errorClass };
    plan = buildPlan(inspected.text, { now, sourceKey, existingFingerprints: read.existing });
  }
  return { ok: true, plan, sourceKey, sha12: inspected.sha256.slice(0, 12) };
}

const HIDDEN = "(hidden: looks like an address)";
/** A title or company that itself holds an address, a link or a long number is not shown: the preview never prints one, whatever the sheet put in a cell. */
export function safeText(value: string): string {
  return /@|https?:|www\.|mailto|\d{9,}/i.test(value) ? HIDDEN : value;
}

export const PREVIEW_NOTICE = "Rows you confirm go live on the public feed at once. Nothing is written by this preview.";

export function previewBody(planned: { plan: Plan; sourceKey: string; sha12: string }) {
  const { plan } = planned;
  const safePlan: Plan = { ...plan, preview: plan.preview.map((p) => ({ ...p, title: safeText(p.title), company: safeText(p.company) })) };
  const byKind = { link: 0, emailPlusLink: 0, emailOnly: 0 };
  for (const item of plan.items) {
    if (item.preview.kind === "link") byKind.link++;
    else if (item.preview.kind === "email+link") byKind.emailPlusLink++;
    else byKind.emailOnly++;
  }
  const reasons = plan.counts.skippedByReason;
  return {
    sha12: planned.sha12,
    sourceKey: planned.sourceKey,
    counts: {
      rows: plan.counts.rows,
      importable: plan.counts.importable,
      importableByKind: byKind,
      batches: plan.counts.batches,
      skippedByReason: reasons,
      inFileDuplicates: reasons["duplicate of an earlier row in this import"] ?? 0,
      alreadyOnTalentrah: reasons["already on Talentrah (same fingerprint)"] ?? 0,
    },
    lines: safePlan.preview.slice(0, PREVIEW_LINE_LIMIT).map((p, i) => ({ line: i + 2, title: p.title, company: p.company, batch: p.batch, reason: p.skipReason })),
    truncated: safePlan.preview.length > PREVIEW_LINE_LIMIT,
    previewCsv: renderPreview(safePlan),
    notice: PREVIEW_NOTICE,
  };
}
