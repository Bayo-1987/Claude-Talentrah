export const NOTICE_MODES = ["instant", "digest", "off"] as const;
export type NoticeMode = (typeof NOTICE_MODES)[number];

/** The names shown in the setting (owner-approved wording, 13 Oct). The STORED values stay instant | digest | off (email_preferences.new_applicant_notice): only these words are copy. */
export const NOTICE_LABELS: Record<NoticeMode, string> = {
  instant: "Quick alert, then daily summary",
  digest: "Daily summary only",
  off: "No emails",
};

/** One line under each option's name, shown for the option that is selected. No clock time or timezone: "each morning" only. */
export const NOTICE_OPTION_HELP: Record<NoticeMode, string> = {
  instant: "One email when a job gets its first new applicant. After that, one summary each morning.",
  digest: "One email each morning listing new applicants.",
  off: "You'll still see applicants on your Applicants page.",
};

/** Under the setting's label. */
export const NOTICE_HELP = "Choose how we tell you when people apply to your jobs.";

/** Shown next to the setting once a change has been saved. */
export const NOTICE_SAVED = "Saved";

/** Shown when a change could not be saved (the previous choice is put back). */
export const NOTICE_SAVE_FAILED = "Couldn't save. Try again.";

export function isNoticeMode(value: unknown): value is NoticeMode {
  return typeof value === "string" && (NOTICE_MODES as readonly string[]).includes(value);
}
