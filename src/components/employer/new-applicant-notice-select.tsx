"use client";

import { useState, useTransition } from "react";
import { setNewApplicantNoticeAction } from "@/lib/employer/new-applicant-notice-actions";
import { NOTICE_HELP, NOTICE_LABELS, NOTICE_MODES, NOTICE_OPTION_HELP, NOTICE_SAVED, isNoticeMode, type NoticeMode } from "@/lib/employer/new-applicants/notice-mode";

/** What the setting looks like for a given state. Pure, so the label, the options, the help text and the Saved message can be rendered and checked without a browser. */
export function NewApplicantNoticeView({
  mode,
  saved,
  error,
  pending,
  onChange,
}: {
  mode: NoticeMode;
  saved: boolean;
  error: string | null;
  pending: boolean;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div data-testid="new-applicant-notice-row" className="flex max-w-[600px] flex-col gap-1">
      <label htmlFor="new-applicant-notice" className="font-body text-[12.5px] font-semibold text-ink-soft">
        Emails about new applicants
      </label>
      <p id="new-applicant-notice-help" className="font-body text-[12.5px] leading-[1.5] text-ink-soft">
        {NOTICE_HELP}
      </p>
      <select
        id="new-applicant-notice"
        value={mode}
        onChange={onChange}
        disabled={pending}
        aria-describedby="new-applicant-notice-help new-applicant-notice-option-help"
        className="h-12 w-full max-w-[360px] border-[1.5px] border-ink bg-card px-3 font-body text-[13.5px] text-ink outline-none focus:border-rust disabled:opacity-60"
      >
        {NOTICE_MODES.map((m) => (
          <option key={m} value={m}>
            {NOTICE_LABELS[m]}
          </option>
        ))}
      </select>
      {/* The help line and the status each keep a fixed amount of room, so choosing another option or "Saved" appearing never moves what is below the row. */}
      <p id="new-applicant-notice-option-help" className="min-h-[38px] font-body text-[12.5px] leading-[1.5] text-ink-soft sm:min-h-[19px]">
        {NOTICE_OPTION_HELP[mode]}
      </p>
      <div className="h-5 leading-5">
        <span role="status" aria-live="polite" className="font-body text-[12.5px] font-semibold text-green">
          {saved && !error ? NOTICE_SAVED : null}
        </span>
        {error && (
          <span role="alert" className="font-body text-[12.5px] text-rust">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** How this person hears about new applicants. Saves on change; says "Saved" once it has, and a failed save puts the previous choice back and says so. */
export function NewApplicantNoticeSelect({ initialMode }: { initialMode: NoticeMode }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isNoticeMode(next)) return;
    const previous = mode;
    setMode(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setNewApplicantNoticeAction(next);
      if (!result.ok) {
        setMode(previous);
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return <NewApplicantNoticeView mode={mode} saved={saved} error={error} pending={pending} onChange={change} />;
}
