import "server-only";
import { randomUUID } from "node:crypto";
import { exportChunks, type BuildStats } from "@/lib/account-export/build";
import { type DataExportEmailTemplate } from "@/lib/account-deletion/export-email";
import { auditCancelled, auditDeleted, auditFinished, auditGenerated, auditNoticeSent, auditRequested, type Admin } from "./audit";
import { exportLinkFor, objectPathFor, type ReasonCode, type RefusalCode, type RequesterCheck, UUID_PATTERN } from "./constants";
import { buildLinkEmail, buildStartNoticeEmail } from "./email";
import {
  cancelUnused,
  failAttempt,
  finishAttempt,
  getLiveRow,
  insertAttempt,
  markObjectDeleted,
  removeObject,
  swapStaleAttempt,
  uploadObject,
  type Client,
} from "./store";
import { checkTarget } from "./target";

/**
 * THE START OF AN EXPORT, and the cancel of an unused one. Every ordering rule of docs/admin-data-export.md is in the order of the statements below.
 *
 *   1. STRICT AUDIT ROW `people.export_requested`, before anything is read. If it cannot be written, NOTHING is read and the answer is "unavailable" (a 503, no detail).
 *   2. Target checks (uuid, not the admin's own account, exists, an admin target). Each refusal ends in ONE final strict `people.export_finished` row with a short refusal code.
 *   3. CLAIM THE ATTEMPT, in one statement: an INSERT when the person has no live export (the partial unique index decides a race: the loser is refused `in_progress`), or the stale swap
 *      when their `generating` row is more than 15 minutes old (a SQL function with one conditional UPDATE: the loser is refused `in_progress`). A live `generated` export that nobody has
 *      opened is refused `live_export_exists` (support cancels it first; see cancelExport). The claim happens BEFORE the notice so two admins starting together cannot each send one.
 *   4. THE NOTICE EMAIL to the registered address: no data, no link. Fail closed: if it cannot be sent the attempt is marked failed, NOTHING is generated, the refusal `notice_failed` is audited.
 *   5. Generate (table by table; a table that cannot be read aborts the file), upload to <export id>/<attempt id>.json in the private bucket.
 *   6. THE FINISH, one conditional UPDATE for the attempt that still owns the row. Zero rows = this attempt was cancelled while it ran: it deletes its own object and sends NO link.
 *   7. STRICT AUDIT ROW `people.export_generated` (counts only). If it cannot be written the export is taken back.
 *   8. THE LINK EMAIL (a separate, short email). If it cannot be sent the export is taken back, so a retry can start at once.
 *   9. The final strict row `people.export_finished` with outcome "completed".
 *
 * No audit row, log line or return value carries personal content: only ids, counts and the short codes in constants.ts. An error is recorded as its CLASS (its name), never its message.
 */

export interface StartDeps {
  service: Client;
  admin: Admin;
  send: (template: DataExportEmailTemplate, payload: { from: string; to: string; subject: string; text: string; html: string }) => Promise<{ error: { message: string } | null }>;
  now?: () => Date;
  newId?: () => string;
  siteOrigin: string;
  supportUrl: string;
  from: string;
  loadBankNames: () => Promise<ReadonlyMap<string, string>>;
}

export type StartResult =
  | { status: "started"; exportId: string }
  | { status: "refused"; code: RefusalCode }
  | { status: "failed"; errorClass: string }
  | { status: "superseded" }
  | { status: "unavailable" };

export interface StartInput {
  targetRaw: string;
  ticket: string;
  reason: ReasonCode;
  requesterCheck: RequesterCheck;
}

const errorClass = (err: unknown): string => (err instanceof Error ? err.name || "Error" : "UnknownError");
const targetOf = (raw: string): string | null => (UUID_PATTERN.test(raw) ? raw.toLowerCase() : null);

export async function startExport(deps: StartDeps, input: StartInput): Promise<StartResult> {
  const { service, admin } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const target = targetOf(input.targetRaw);

  let requestedId: string;
  try {
    requestedId = await auditRequested(admin, { operation: "start", targetId: target, ticket: input.ticket, reason: input.reason, requesterCheck: input.requesterCheck });
  } catch {
    return { status: "unavailable" };
  }

  const finish = async (outcome: Parameters<typeof auditFinished>[1]["outcome"], extra: { refusalCode?: RefusalCode; exportId?: string; errorClass?: string }): Promise<boolean> => {
    try {
      await auditFinished(admin, { requestedId, targetId: target, outcome, exportId: extra.exportId ?? null, refusalCode: extra.refusalCode ?? null, errorClass: extra.errorClass ?? null });
      return true;
    } catch {
      return false;
    }
  };
  const refuse = async (code: RefusalCode, exportId?: string): Promise<StartResult> => ((await finish("refused", { refusalCode: code, exportId })) ? { status: "refused", code } : { status: "unavailable" });
  const fail = async (cls: string, exportId?: string): Promise<StartResult> => {
    await finish("failed", { errorClass: cls, exportId });
    return { status: "failed", errorClass: cls };
  };

  if (!target) return refuse("not_a_uuid");

  let exportId = "";
  let attemptId = "";
  let objectUploaded = false;
  try {
    const checked = await checkTarget(service, admin, target);
    if (!checked.ok) return await refuse(checked.code);
    const person = checked.person;

    // ── 3. claim the attempt, in one statement ──
    let swappedFrom: string | null = null;
    attemptId = newId();
    for (let pass = 0; ; pass++) {
      const live = await getLiveRow(service, person.id);
      if (live === null) {
        exportId = newId();
        const inserted = await insertAttempt(service, { exportId, attemptId, userId: person.id, adminId: admin.adminId });
        if (inserted === "already_live") return await refuse("in_progress");
        break;
      }
      if (live.status === "generating") {
        // The database decides whether it is stale (older than 15 minutes) and whether this caller wins; zero rows = not stale, or somebody else swapped it first.
        const won = await swapStaleAttempt(service, { exportId: live.id, oldAttemptId: live.attempt_id, newAttemptId: attemptId });
        if (!won) return await refuse("in_progress");
        exportId = live.id;
        swappedFrom = live.attempt_id;
        break;
      }
      // A live "generated" export. If its 72 hours have passed it is dead: clear it (opportunistic sweep) and look again, once.
      const dead = live.expires_at !== null && new Date(live.expires_at).getTime() <= now().getTime();
      if (!dead || pass > 0) return await refuse("live_export_exists", live.id);
      if (live.object_path) await removeObject(service, live.object_path);
      await markObjectDeleted(service, { exportId: live.id, attemptId: live.attempt_id, status: "expired" });
      await auditDeleted({ exportId: live.id, reason: "expired", userId: person.id });
    }

    if (swappedFrom) {
      // The winner of the swap removes the OLD attempt's object (it may never have been written) and records the cancellation.
      await removeObject(service, objectPathFor(exportId, swappedFrom));
      await auditDeleted({ exportId, reason: "cancelled", actor: admin, userId: person.id });
    }

    // ── 4. the notice, before a single table is read ──
    let noticeError = false;
    try {
      const notice = buildStartNoticeEmail({ firstName: person.firstName, startedAt: now(), supportUrl: deps.supportUrl });
      const sent = await deps.send("data_export_generated", { from: deps.from, to: person.email, subject: notice.subject, text: notice.text, html: notice.html });
      noticeError = sent.error !== null;
    } catch {
      noticeError = true;
    }
    if (noticeError) {
      console.error("[data-export] the start notice could not be sent; nothing was generated");
      await failAttempt(service, { exportId, attemptId });
      return await refuse("notice_failed", exportId);
    }
    await auditNoticeSent(admin, { requestedId, targetId: person.id, exportId });

    // ── 5. generate and upload ──
    const stats: BuildStats = { tables: 0, rows: 0 };
    const pieces: string[] = [];
    for await (const piece of exportChunks({ client: service, userId: person.id, now: now(), supportUrl: deps.supportUrl, loadBankNames: deps.loadBankNames }, stats)) pieces.push(piece);
    const body = new Blob(pieces, { type: "application/json" });
    const path = objectPathFor(exportId, attemptId);
    await uploadObject(service, path, body);
    objectUploaded = true;

    // ── 6. the finish: one conditional UPDATE for the attempt that still owns the row ──
    const expiresAt = await finishAttempt(service, { exportId, attemptId, objectPath: path });
    if (expiresAt === null) {
      await removeObject(service, path);
      objectUploaded = false;
      await auditDeleted({ exportId, reason: "cancelled", actor: admin, userId: person.id });
      await finish("superseded", { exportId });
      return { status: "superseded" };
    }

    // ── 7. strict audit of the generated file; if it cannot be written the export is taken back ──
    try {
      await auditGenerated(admin, { requestedId, targetId: person.id, exportId, tables: stats.tables, rows: stats.rows, bytes: body.size });
    } catch {
      await takeBack(service, exportId, person.id, path);
      objectUploaded = false;
      return { status: "unavailable" };
    }

    // ── 8. the link, in its own email ──
    let linkError = false;
    try {
      const link = buildLinkEmail({ firstName: person.firstName, link: exportLinkFor(deps.siteOrigin, exportId), expiresAt: new Date(expiresAt), supportUrl: deps.supportUrl });
      const sent = await deps.send("data_export_link", { from: deps.from, to: person.email, subject: link.subject, text: link.text, html: link.html });
      linkError = sent.error !== null;
    } catch {
      linkError = true;
    }
    if (linkError) {
      console.error("[data-export] the link email could not be sent; the export was taken back");
      await takeBack(service, exportId, person.id, path);
      await auditDeleted({ exportId, reason: "failed", userId: person.id });
      objectUploaded = false;
      return await fail("LinkEmailFailed", exportId);
    }

    // ── 9. the final row ──
    if (!(await finish("completed", { exportId }))) return { status: "unavailable" };
    return { status: "started", exportId };
  } catch (err) {
    // Any read, upload or database error: nothing is delivered. The attempt is failed and its object (if one was written) removed, so a new export can start at once.
    const cls = errorClass(err);
    console.error("[data-export] the start failed", cls);
    if (exportId && attemptId) {
      await failAttempt(service, { exportId, attemptId }).catch(() => false);
      if (objectUploaded) {
        await removeObject(service, objectPathFor(exportId, attemptId));
        await auditDeleted({ exportId, reason: "failed" });
      }
    }
    return fail(cls, exportId || undefined);
  }
}

/** Takes a finished-but-undelivered export back: generated -> cancelled, then the object. (A refused cancel here means somebody already opened or cancelled it, which is fine.) */
async function takeBack(service: Client, exportId: string, userId: string, path: string): Promise<void> {
  await cancelUnused(service, { exportId, userId }).catch(() => null);
  await removeObject(service, path);
}

/* ─── support's way out of a lost link ───────────────────────────────────────────────────────────────────────────────────────────────── */

export interface CancelDeps {
  service: Client;
  admin: Admin;
}

export type CancelResult = { status: "cancelled"; exportId: string } | { status: "refused"; code: RefusalCode } | { status: "failed"; errorClass: string } | { status: "unavailable" };

/**
 * CANCEL AN UNUSED EXPORT: ONE conditional UPDATE through cancel_unused_data_export (generated and never claimed -> cancelled). Same guards as a start (not the admin's own account, an admin target).
 * Frees the person's one-live-export slot at once. The person is NOT emailed: it exposes no data and they did not ask for it. Starts with the same strict `requested` row and ends with the same
 * strict `finished` row, so no request is left without an outcome; a refusal is `not_cancellable`.
 */
export async function cancelExport(deps: CancelDeps, input: { targetRaw: string; ticket: string }): Promise<CancelResult> {
  const { service, admin } = deps;
  const target = targetOf(input.targetRaw);

  let requestedId: string;
  try {
    requestedId = await auditRequested(admin, { operation: "cancel", targetId: target, ticket: input.ticket, reason: null, requesterCheck: null });
  } catch {
    return { status: "unavailable" };
  }
  const finish = async (outcome: Parameters<typeof auditFinished>[1]["outcome"], extra: { refusalCode?: RefusalCode; exportId?: string; errorClass?: string }): Promise<boolean> => {
    try {
      await auditFinished(admin, { requestedId, targetId: target, outcome, exportId: extra.exportId ?? null, refusalCode: extra.refusalCode ?? null, errorClass: extra.errorClass ?? null });
      return true;
    } catch {
      return false;
    }
  };
  const refuse = async (code: RefusalCode, exportId?: string): Promise<CancelResult> => ((await finish("refused", { refusalCode: code, exportId })) ? { status: "refused", code } : { status: "unavailable" });

  if (!target) return refuse("not_a_uuid");
  try {
    const checked = await checkTarget(service, admin, target);
    if (!checked.ok) return await refuse(checked.code);

    const live = await getLiveRow(service, checked.person.id);
    if (!live || live.status !== "generated") return await refuse("not_cancellable", live?.id);
    const path = await cancelUnused(service, { exportId: live.id, userId: checked.person.id });
    if (path === null) return await refuse("not_cancellable", live.id);

    // The bytes: a failed delete leaves the object for the sweep's whole-bucket pass (a cancelled row is not live, so its object is an orphan there).
    await removeObject(service, path);
    await auditDeleted({ exportId: live.id, reason: "cancelled", actor: admin, userId: checked.person.id });
    try {
      await auditCancelled(admin, { requestedId, targetId: checked.person.id, exportId: live.id });
    } catch {
      console.error("[data-export] the cancel was done but its audit row could not be written");
    }
    if (!(await finish("cancelled", { exportId: live.id }))) return { status: "unavailable" };
    return { status: "cancelled", exportId: live.id };
  } catch (err) {
    const cls = errorClass(err);
    console.error("[data-export] the cancel failed", cls);
    await finish("failed", { errorClass: cls });
    return { status: "failed", errorClass: cls };
  }
}
