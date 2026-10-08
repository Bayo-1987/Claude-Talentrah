/**
 * The ONE decision about whether a scholarship's deadline note may be shown to the public (#594).
 *
 * `scholarships.deadline_note` is the copy an applicant reads in place of a date when a provider genuinely has no single deadline ("varies by partner
 * institution"). The model has always said it is valid only alongside a verified-deadline stamp (`deadline_verified_at`, src/lib/scholarships/types.ts):
 * "varies by design" is a verified finding, not a missing one. Nothing enforced that, and a listing went public with a reviewer's "a human should confirm
 * this date before publishing" as its deadline, on every surface at once, because each surface printed the column itself.
 *
 * So every public surface asks here, and this FAILS CLOSED: no stamp (or a stamp that the query did not even select) means no note, and the surface says
 * "Not published yet". `tests/scholarships/public-deadline-note.test.tsx` fails the build if any file in src/ reads `.deadline_note` any other way.
 * Migration 0217 enforces the same rule in the database for verified listings, so a direct insert cannot publish an unverified note either.
 */
export const DEADLINE_NOTE_MAX_LENGTH = 600;

type NoteFields = { deadline_note: string | null; deadline_verified_at?: string | null };

/** The note, trimmed, only when the deadline has a verified stamp; otherwise null. */
export function publicDeadlineNote(row: NoteFields): string | null {
  const note = row.deadline_note?.trim();
  if (!note) return null;
  if (!row.deadline_verified_at) return null;
  return note;
}

/** What a surface prints in place of a date: the verified note, or "Not published yet". */
export function deadlineNoteOrFallback(row: NoteFields): string {
  return publicDeadlineNote(row) ?? "Not published yet";
}

/** The admin form's live character count against the limit. */
export function noteCounter(length: number): { text: string; over: boolean } {
  const over = length > DEADLINE_NOTE_MAX_LENGTH;
  return { text: over ? `${length} / ${DEADLINE_NOTE_MAX_LENGTH} (${length - DEADLINE_NOTE_MAX_LENGTH} over)` : `${length} / ${DEADLINE_NOTE_MAX_LENGTH}`, over };
}

/** The two database rules on a deadline note (migration 0217), by constraint name. */
export const NOTE_STAMP_CONSTRAINT = "scholarships_verified_note_needs_stamp";
export const NOTE_LENGTH_CONSTRAINT = "scholarships_deadline_note_max_600";

export const NOTE_NEEDS_STAMP_MESSAGE =
  "A deadline note needs a verified-deadline date. A listing added by hand has none, so remove the note or approve it through a source that verifies the deadline.";
export const NOTE_TOO_LONG_MESSAGE = `Keep the note to ${DEADLINE_NOTE_MAX_LENGTH} characters or fewer`;

/**
 * A listing added BY HAND never has a verified deadline, and a verified listing may carry a deadline note only if its deadline was verified (0217). So a note on a hand-entered
 * listing is refused at SAVE, with the message approval gives, instead of being saved as pending and refused later. Returns the message, or null when there is no note to refuse.
 */
export function handEntryNoteRefusal(note: string | null | undefined): string | null {
  return note != null && note.trim() !== "" ? NOTE_NEEDS_STAMP_MESSAGE : null;
}


/** Turns a database error string naming one of the two rules into the sentence an operator should read; null for any other error. */
export function deadlineNoteRuleMessage(errorText: string | null | undefined): string | null {
  if (!errorText) return null;
  if (errorText.includes(NOTE_STAMP_CONSTRAINT)) return NOTE_NEEDS_STAMP_MESSAGE;
  if (errorText.includes(NOTE_LENGTH_CONSTRAINT)) return NOTE_TOO_LONG_MESSAGE;
  return null;
}
