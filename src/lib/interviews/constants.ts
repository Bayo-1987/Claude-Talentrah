/** Schedule interview (0253): the kinds and limits in one place. The database enforces the same numbers. */
export const INTERVIEW_KINDS = ["video", "phone", "in_person"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const KIND_LABELS: Record<InterviewKind, string> = {
  video: "Video call",
  phone: "Phone call",
  in_person: "In person",
};

export const MIN_SLOTS = 2;
export const MAX_SLOTS = 5;
export const MIN_DURATION = 15;
export const MAX_DURATION = 240;
export const NOTE_MAX = 500;

export function isInterviewKind(value: unknown): value is InterviewKind {
  return typeof value === "string" && (INTERVIEW_KINDS as readonly string[]).includes(value);
}
