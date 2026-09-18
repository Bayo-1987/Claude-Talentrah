/**
 * Carries the exercise files an employer picked on the CREATE form across
 * the redirect postJobAction makes to the post-success card (send-364) —
 * the only reason this exists at all is that a file needs a real jobId
 * (assessment-document.ts's exerciseObjectPath), which doesn't exist until
 * AFTER that redirect, but the employer picks the files BEFORE.
 *
 * ── WHY THIS IS INDEXEDDB, NOT SESSIONSTORAGE LIKE pending-job-banner.ts ───
 *
 * pending-job-banner.ts stages ONE cropped, compressed image as a `data:`
 * URL string in sessionStorage — "a few hundred KB to ~2.7MB base64-encoded"
 * by its own comment, comfortably inside sessionStorage's per-origin quota
 * (commonly 5-10MB in real browsers). An assessment exercise document can be
 * up to MAX_ASSESSMENT_DOCUMENT_BYTES (5MB) EACH, up to MAX_ASSESSMENT_FILES
 * of them, base64-encoded — that blows well past sessionStorage's ceiling
 * the first time a real recruiter attaches a real few-MB PDF plus a
 * spreadsheet. IndexedDB's practical quota is a meaningful fraction of free
 * disk, not a fixed few MB, and it stores Blobs natively — no base64
 * encoding, no 33% size inflation, no `FileReader` round trip at all.
 *
 * ── WHY THE WRITE HAPPENS AT PICK/REMOVE TIME, NOT AT SUBMIT TIME LIKE THE
 *    BANNER'S CAPTURING SUBMIT LISTENER ─────────────────────────────────────
 *
 * new-job-banner-picker.tsx deliberately does NOT write to sessionStorage
 * until the literal instant of submit, via a capturing `submit` listener on
 * `document` — because submitting JobPostingForm remounts that picker
 * component (part of postJobAction's own pending transition, BEFORE the
 * redirect), and an earlier version that wrote at crop-confirm time and
 * cleared on every mount got wiped by that incidental remount before the
 * post-success page ever read it.
 *
 * That specific bug was about a MOUNT-TIME CLEAR racing a remount, not about
 * writing early being unsafe in itself — and IndexedDB has no SYNCHRONOUS
 * write API the way sessionStorage.setItem does, so replicating "write
 * synchronously at the literal submit instant" isn't even available here.
 * Rather than force a synchronous guarantee IndexedDB cannot provide (or
 * try to preventDefault-await-resubmit the form, which risks interfering
 * with React's own Server Action wiring on the same submit event in ways
 * this module can't verify are safe), this file takes a different, simpler
 * design that sidesteps the remount hazard entirely: THIS MODULE HAS NO
 * MOUNT-TIME CLEAR AT ALL. The picker writes the full current file list to
 * IndexedDB on every pick/remove — so it's always already in sync with
 * whatever the employer is looking at — and there is nothing left for a
 * remount to race, because nothing clears on mount.
 *
 * The one gap this leaves, and how it's closed: if an employer picks files,
 * then abandons the create form (navigates away without submitting) without
 * removing them, the staged entry would otherwise sit in IndexedDB and get
 * consumed by whatever job THIS SAME TAB creates next — the same "stale
 * leftover attaches to the wrong job" risk the banner's own submit-listener
 * else-branch defends against. `clearIfNothingStagedThisSession` exists for
 * exactly that: the create page calls it (best-effort, fire-and-forget) from
 * a capturing submit listener ONLY when the picker's own current session
 * has nothing staged, clearing any stale entry from an earlier abandoned
 * attempt before a fresh, unrelated submission can inherit it. Because it
 * only ever DELETES, its own async timing relative to the redirect doesn't
 * matter the way a write's timing would: the worst case of it losing the
 * race is that today's exact same (harmless-if-slow) cleanup runs on the
 * NEXT submission instead.
 *
 * ── CONSUMED AT MOST ONCE ───────────────────────────────────────────────────
 *
 * `takePendingAssessmentFiles` always clears the staged entry before
 * returning, win or lose — same reasoning as takePendingJobBanner: a failed
 * attach must not retry against a LATER, unrelated job posting.
 */

const DB_NAME = "talentrah-pending-job-assessment-files";
const STORE_NAME = "staged";
const RECORD_KEY = "pending";

export interface PendingAssessmentFileEntry {
  name: string;
  type: string;
  blob: Blob;
}

interface PendingRecord {
  userId: string;
  files: PendingAssessmentFileEntry[];
}

/**
 * The one piece of this file with no browser API in it, pulled out so the
 * ownership check is testable with a plain object rather than a real
 * IndexedDB — the same split pending-job-banner.ts draws for
 * parseOwnedPendingBanner. A record staged by a different signed-in user
 * (or nothing at all) is not this caller's to use.
 */
export function isOwnedPendingRecord(
  record: PendingRecord | null | undefined,
  currentUserId: string,
): record is PendingRecord {
  return !!record && !!record.userId && record.userId === currentUserId;
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Could not open storage."));
      return;
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open storage."));
  });
}

/**
 * Replaces the whole staged set with EXACTLY the files passed in — the
 * picker calls this on every pick/remove with its own current, complete
 * list, so IndexedDB is always a mirror of what's on screen rather than
 * something incrementally patched. `files: []` is a valid call (clears the
 * entry) but callers with nothing to stage should prefer
 * `clearPendingAssessmentFiles` directly for clarity.
 *
 * Throws on failure (a locked-down context such as private browsing in some
 * browsers can refuse IndexedDB outright, or refuse a write to it) — the
 * caller decides what to do with that; see isIndexedDbAvailable for a
 * before-the-fact check.
 */
export async function writePendingAssessmentFiles(userId: string, files: File[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const record: PendingRecord = {
        userId,
        files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
      };
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not stage the files."));
    });
  } finally {
    db.close();
  }
}

/**
 * Drops any staged files without using them — best-effort, since the goal
 * is just "don't leave this lying around" and a failure here isn't worth
 * surfacing (mirrors clearPendingJobBanner's own stance).
 */
export async function clearPendingAssessmentFiles(): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // Nothing to degrade to — see this file's own header.
  }
}

/**
 * The create page's own capturing-submit-listener safety net (see this
 * file's header) — clears any stale leftover from an earlier abandoned
 * attempt, but ONLY when told nothing is staged for THIS submission, so it
 * never clears out files the employer just picked for the posting actually
 * being published right now.
 */
export function clearIfNothingStagedThisSession(hasStagedThisSession: boolean): void {
  if (hasStagedThisSession) return;
  void clearPendingAssessmentFiles();
}

/**
 * Reads and immediately clears whatever is staged, returning it as Files
 * ready for the same upload assessment-exercise-upload.tsx already does —
 * or an empty array if there was nothing staged, it couldn't be read, or it
 * belonged to a different signed-in user than `currentUserId`.
 */
export async function takePendingAssessmentFiles(currentUserId: string): Promise<File[]> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return [];
  }

  let record: PendingRecord | undefined;
  try {
    record = await new Promise<PendingRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      req.onsuccess = () => resolve(req.result as PendingRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("Could not read staged files."));
    });
  } catch {
    record = undefined;
  } finally {
    db.close();
  }

  await clearPendingAssessmentFiles();

  if (!isOwnedPendingRecord(record, currentUserId)) return [];
  return record.files.map((f) => new File([f.blob], f.name, { type: f.type }));
}
