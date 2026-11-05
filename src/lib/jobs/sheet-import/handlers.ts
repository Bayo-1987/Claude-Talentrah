import { batchRows } from "./plan";
import { JOBS_IMPORT_PERMISSION, type AdminRef, type ImportAudit } from "./constants";
import { FORM_OVERHEAD_BYTES, MAX_UPLOAD_BYTES } from "./limits";
import { inspectUpload, planUpload, previewBody, type Inspected } from "./upload";
import { classOfError, writeBatch, type ImportWriteClient } from "./write";

/**
 * The two POST handlers of the admin jobs uploader (PR-U1), written as functions of their dependencies so a test hands in fakes and the route files hand in the real ones (deps.ts).
 *
 * EACH CARRIES ITS OWN GUARD, because the protected layout does not cover route handlers (the same shape as /admin/data-export): the request must come from this site's own origin; the
 * identity comes from the ADMIN SESSION only (never the seeker session, never the request); none -> 401; an identity without `jobs_import` -> 403 and a `jobs.import_denied` audit row.
 * Nothing is read from the file, planned or written before those pass.
 *
 * AUTHORITY NEVER COMES FROM THE CLIENT. The confirm takes the file again plus three numbers the admin was shown (hash, importable, batches) and a tick; it recomputes the whole plan from the
 * bytes and writes nothing unless its own numbers are the same. No row, key, batch or source comes from the form.
 *
 * NO ADDRESS LEAVES THIS FILE. Every failure path answers, logs and audits an error CLASS only (classOfError): a database error can quote the failing row, so no error's text is ever read.
 */
export interface AdminLike extends AdminRef {
  permissions: readonly string[];
}

export interface HandlerDeps {
  getAdmin(): Promise<AdminLike | null>;
  audit: ImportAudit;
  /** The service-role client, asked for ONLY after the permission check passes (and possibly loaded lazily, hence the promise). */
  service(): ImportWriteClient | Promise<ImportWriteClient>;
  now(): Date;
  /** One short class per failure, for the server log. */
  log(errorClass: string): void;
}

const MESSAGES = {
  bad_origin: "That request did not come from this site.",
  not_signed_in: "Sign in to the admin area.",
  missing_permission: "You do not have the jobs import permission.",
  too_large: "That file is over 2 MB.",
  too_many_rows: "That file has more than 1,000 rows. Split it and upload the parts one at a time.",
  empty: "That file is empty.",
  not_csv: "That file is not a text CSV file.",
  missing_columns: "The file is missing required columns.",
  no_file: "Choose a CSV file.",
  unreadable: "The upload could not be read.",
  preview_changed: "The file or the database changed since the preview. Preview it again before confirming.",
  not_confirmed: "Tick the box to confirm that you read the preview.",
  audit_unavailable: "The audit log is unavailable, so nothing was written.",
  read_failed: "The database could not be read. Nothing was written. Try again.",
} as const;

function reply(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const refuse = (code: keyof typeof MESSAGES, status: number, extra: Record<string, unknown> = {}) => reply({ ok: false, code, message: MESSAGES[code], ...extra }, status);

type Guarded = { ok: true; admin: AdminLike } | { ok: false; response: Response };

async function guard(request: Request, route: "preview" | "confirm", deps: HandlerDeps): Promise<Guarded> {
  if (request.headers.get("origin") !== new URL(request.url).origin) return { ok: false, response: refuse("bad_origin", 403) };
  const admin = await deps.getAdmin();
  if (!admin) return { ok: false, response: refuse("not_signed_in", 401) };
  if (!admin.permissions.includes(JOBS_IMPORT_PERMISSION)) {
    try {
      await deps.audit.denied(admin, { route, reason: "missing_permission" });
    } catch (e) {
      deps.log(classOfError(e));
    }
    return { ok: false, response: refuse("missing_permission", 403) };
  }
  return { ok: true, admin };
}

type Read = { ok: true; bytes: Uint8Array; form: FormData; inspected: Extract<Inspected, { ok: true }> } | { ok: false; response: Response };

/** The form, the file and the limits. A length header over the limit is refused before the body is read; the bytes are checked again after. */
async function readUpload(request: Request): Promise<Read> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES) return { ok: false, response: refuse("too_large", 413) };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: refuse("unreadable", 400) };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, response: refuse("no_file", 400) };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, response: refuse("too_large", 413) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectUpload(bytes);
  if (!inspected.ok) return { ok: false, response: refuse(inspected.code, inspected.status, inspected.columns ? { columns: inspected.columns } : {}) };
  return { ok: true, bytes, form, inspected };
}

/** POST /admin/jobs-import/preview: reads only. Counts, skip reasons, duplicates, the first lines and the preview CSV; no address of any kind. */
export async function handlePreview(request: Request, deps: HandlerDeps): Promise<Response> {
  const g = await guard(request, "preview", deps);
  if (!g.ok) return g.response;
  const upload = await readUpload(request);
  if (!upload.ok) return upload.response;
  const planned = await planUpload(upload.inspected, deps.now(), await deps.service());
  if (!planned.ok) {
    deps.log(planned.errorClass);
    return refuse("read_failed", 503);
  }
  return reply({ ok: true, preview: previewBody(planned) }, 200);
}

const WHOLE_NUMBER = /^\d{1,6}$/;

/** POST /admin/jobs-import/confirm: the only write. */
export async function handleConfirm(request: Request, deps: HandlerDeps): Promise<Response> {
  const g = await guard(request, "confirm", deps);
  if (!g.ok) return g.response;
  const upload = await readUpload(request);
  if (!upload.ok) return upload.response;

  const tick = String(upload.form.get("tick") ?? "");
  if (tick !== "on" && tick !== "true") return refuse("not_confirmed", 400);

  const client = await deps.service();
  const planned = await planUpload(upload.inspected, deps.now(), client);
  if (!planned.ok) {
    deps.log(planned.errorClass);
    return refuse("read_failed", 503);
  }
  const { plan, sourceKey, sha12 } = planned;
  const echoedHash = String(upload.form.get("sha12") ?? "");
  const echoedImportable = String(upload.form.get("importable") ?? "");
  const echoedBatches = String(upload.form.get("batches") ?? "");
  if (echoedHash !== sha12 || !WHOLE_NUMBER.test(echoedImportable) || !WHOLE_NUMBER.test(echoedBatches) || Number(echoedImportable) !== plan.counts.importable || Number(echoedBatches) !== plan.counts.batches) {
    return refuse("preview_changed", 409);
  }

  const kinds = { link: 0, email_plus_link: 0, email_only: 0 };
  for (const item of plan.items) {
    if (item.preview.kind === "link") kinds.link++;
    else if (item.preview.kind === "email+link") kinds.email_plus_link++;
    else kinds.email_only++;
  }
  let requestedId: string;
  try {
    requestedId = await deps.audit.requested(g.admin, {
      source_key: sourceKey,
      csv_sha12: sha12,
      rows: plan.counts.rows,
      importable: plan.counts.importable,
      batches: plan.counts.batches,
      importable_link: kinds.link,
      importable_email_plus_link: kinds.email_plus_link,
      importable_email_only: kinds.email_only,
    });
  } catch (e) {
    deps.log(classOfError(e));
    return refuse("audit_unavailable", 503);
  }

  let inserted = 0;
  let skippedExisting = 0;
  let batchesDone = 0;
  let errorClass: string | null = null;
  for (let batch = 1; batch <= plan.counts.batches; batch++) {
    const result = await writeBatch(client, batchRows(plan, batch).map((i) => i.insert));
    if (!result.ok) {
      errorClass = result.errorClass;
      deps.log(errorClass);
      break;
    }
    inserted += result.inserted;
    skippedExisting += result.skippedExisting;
    batchesDone++;
  }
  const outcome = errorClass === null ? "completed" : batchesDone === 0 ? "failed" : "partial";
  let auditRecorded = true;
  try {
    await deps.audit.finished(g.admin, {
      requested_id: requestedId,
      source_key: sourceKey,
      outcome,
      inserted,
      skipped_existing: skippedExisting,
      batches_done: batchesDone,
      batches_total: plan.counts.batches,
      error_class: errorClass,
    });
  } catch (e) {
    auditRecorded = false;
    deps.log(classOfError(e));
  }
  const counts = { inserted, skippedExisting, batchesDone, batchesTotal: plan.counts.batches, sourceKey, auditRecorded };
  if (errorClass === null) return reply({ ok: true, outcome, ...counts, message: `${inserted} jobs were added and ${skippedExisting} were already there.` }, 200);
  return reply(
    { ok: false, outcome, ...counts, message: `${inserted} jobs were added before a database error stopped the upload. Run the same file again: rows already in are skipped.` },
    500,
  );
}
