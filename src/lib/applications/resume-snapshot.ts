import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

/**
 * `applications.resume_snapshot` / `.cover_letter_snapshot` — the frozen copy
 * of what was sent, written by `delete_resume_with_snapshot` (migration 0094)
 * at the moment the source resume is deleted.
 *
 * WHY THIS FILE EXISTS AT ALL. A snapshot nobody reads is not a fix — it is a
 * column that makes the schema look careful while the tracker still loses the
 * answer to "what did I actually send these people?". The column and this
 * reader ship together for the same reason the column and the `ON DELETE SET
 * NULL` ship in one migration.
 *
 * PARSED DEFENSIVELY, not cast. It is `jsonb`, so the type system knows
 * nothing about it, and 0094's header records the deliberate decision NOT to
 * revoke the owner's UPDATE grant on `applications` — which means the column
 * is writable by its owner and this reader must survive a row that has been
 * hand-edited into nonsense. A malformed snapshot degrades to "no snapshot",
 * never to a crashed tracker.
 */
export interface ResumeSnapshot {
  /** The id the resume had before it was deleted. Provenance only — it resolves to nothing. */
  resumeId: string | null;
  title: string;
  content: StructuredResume;
  capturedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseResumeSnapshot(raw: unknown): ResumeSnapshot | null {
  if (!isRecord(raw)) return null;

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title : null;
  if (!title) return null;

  // The content is what makes the snapshot worth keeping, but a snapshot with
  // only a title is still better than nothing on the card — so an unusable
  // `structuredContent` falls back to an empty document rather than
  // discarding the whole row.
  const content = isRecord(raw.structuredContent)
    ? ({ ...EMPTY_RESUME, ...(raw.structuredContent as Partial<StructuredResume>) } as StructuredResume)
    : EMPTY_RESUME;

  return {
    resumeId: typeof raw.resumeId === "string" ? raw.resumeId : null,
    title,
    content,
    capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : null,
  };
}
