/**
 * The seeker's screening gate: what it says about attachments, a disabled Submit, and what was sent (see
 * tests/jobs/screening-gate-copy.test.ts for why). Pure strings so the wording is testable and cannot drift.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const NO_FILE_ATTACHED = "No file attached";

export function attachedItemText(name: string, bytes: number): string {
  return `Attached: ${name} (${formatBytes(bytes)})`;
}

/** What the confirmation says was sent: the files by name, or plainly that there were none. */
export function sentNoteText(fileNames: string[]): string {
  return fileNames.length > 0 ? `Submitted with ${fileNames.join(", ")}` : "Submitted without an attachment";
}

/** Why Submit is disabled, in one sentence naming every blocker, or null when nothing blocks it. */
export function submitBlockedReason(s: {
  requiredQuestionsUnanswered: boolean;
  assessmentResponseMissing: boolean;
  answerTooLong: boolean;
}): string | null {
  const parts: string[] = [];
  if (s.requiredQuestionsUnanswered) parts.push("answer the required questions");
  if (s.assessmentResponseMissing) parts.push("write a response, add a link or attach a file");
  if (s.answerTooLong) parts.push("shorten the long answer");
  if (parts.length === 0) return null;
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `To submit, ${sentence}.`;
}

/**
 * The confirmation, from what was STORED (never from what the browser believes it sent): the names of the files saved
 * against the application's assessment submission. `null` when there is no stored submission, in which case nothing is
 * claimed. A stored submission with no stored file says so plainly, which is also the truthful answer when an upload failed.
 */
export function storedSentNote(submission: { fileNames: string[] } | null): string | null {
  return submission ? sentNoteText(submission.fileNames) : null;
}
