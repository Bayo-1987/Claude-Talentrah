export const NOTICE_MODES = ["instant", "digest", "off"] as const;
export type NoticeMode = (typeof NOTICE_MODES)[number];

export const NOTICE_LABELS: Record<NoticeMode, string> = {
  instant: "Instant for a job's first new applicant, then a daily digest",
  digest: "Daily digest only",
  off: "Off",
};

export function isNoticeMode(value: unknown): value is NoticeMode {
  return typeof value === "string" && (NOTICE_MODES as readonly string[]).includes(value);
}
