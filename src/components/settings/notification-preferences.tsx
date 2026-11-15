"use client";

import { useState, useTransition, type ReactNode } from "react";
import { setNotificationPreferenceAction } from "@/app/(app)/settings/notification-actions";
import type { NotificationPreferenceColumn, NotificationPreferenceValues } from "./notification-preferences-model";

type Row = { column: NotificationPreferenceColumn; label: string; hint: string };

const PUSH_ROWS: Row[] = [
  { column: "push_new_applicant", label: "A new applicant on a job you posted", hint: "For employers." },
  { column: "push_application_viewed", label: "An employer has viewed your application", hint: "When an employer opens your resume." },
  { column: "push_match_alert", label: "An exceptional job match", hint: "Only matches rated Excellent." },
  { column: "push_promotions", label: "Offers and promotions by push", hint: "Off unless you turn it on." },
];
const EMAIL_ROWS: Row[] = [
  { column: "email_announcements", label: "Announcements by email", hint: "News about Talentrah. Receipts and password resets always arrive." },
  { column: "email_promotions", label: "Offers and promotions by email", hint: "Off unless you turn it on." },
];

const ERRORS: Record<string, string> = {
  signed_out: "Sign in again to change this.",
  unavailable: "Notification settings are not available right now.",
  unknown_setting: "That setting could not be changed.",
  not_saved: "That didn't save. Try again.",
};

function Switch({ label, checked, disabled, onClick }: { label: string; checked: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative inline-flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors before:absolute before:-inset-[7px] before:content-['']",
        checked ? "bg-ink" : "bg-paper",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      <span className={["inline-block h-[16px] w-[16px] rounded-full transition-transform", checked ? "translate-x-[25px] bg-paper" : "translate-x-[4px] bg-ink"].join(" ")} />
    </button>
  );
}

export function NotificationPreferencesView({
  values,
  onToggle,
  busy,
  notes,
  error,
  optIn,
}: {
  values: NotificationPreferenceValues;
  onToggle: (column: NotificationPreferenceColumn, next: boolean) => void;
  busy: string | null;
  notes: Partial<Record<string, string>>;
  error: string | null;
  optIn: ReactNode;
}) {
  const line = (row: Row) => (
    <div key={row.column} className="flex items-start justify-between gap-4 border-b border-line py-3">
      <div className="min-w-0">
        <p className="font-body text-[14px] font-semibold text-ink">{row.label}</p>
        <p className="font-display text-[13px] italic text-ink-soft">{row.hint}</p>
        {notes[row.column] === "push_off" && (
          <p className="mt-1 font-body text-[13px] text-rust">Push is off, so this will not send until you turn on push notifications.</p>
        )}
      </div>
      <Switch label={row.label} checked={values[row.column]} disabled={busy === row.column} onClick={() => onToggle(row.column, !values[row.column])} />
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="font-body text-[14px] text-rust">
          {error}
        </p>
      )}
      <section className="flex flex-col">
        <h2 className="font-display text-[20px] font-semibold text-ink">Push notifications</h2>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <div className="min-w-0">
            <p className="font-body text-[14px] font-semibold text-ink">Push notifications on this device</p>
            <p className="font-display text-[13px] italic text-ink-soft">The master switch for every push below.</p>
          </div>
          <Switch label="Push notifications on this device" checked={values.push_enabled} disabled={busy === "push_enabled"} onClick={() => onToggle("push_enabled", !values.push_enabled)} />
        </div>
        <div className="py-3">{optIn}</div>
        {PUSH_ROWS.map(line)}
      </section>
      <section className="flex flex-col">
        <h2 className="font-display text-[20px] font-semibold text-ink">Email</h2>
        {EMAIL_ROWS.map(line)}
      </section>
    </div>
  );
}

export function NotificationPreferences({ initial, optIn }: { initial: NotificationPreferenceValues; optIn: ReactNode }) {
  const [values, setValues] = useState<NotificationPreferenceValues>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Partial<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function onToggle(column: NotificationPreferenceColumn, next: boolean) {
    const before = values[column];
    setError(null);
    setValues((v) => ({ ...v, [column]: next }));
    setBusy(column);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setNotificationPreferenceAction>>;
      try {
        result = await setNotificationPreferenceAction(column, next);
      } catch {
        result = { ok: false, error: "not_saved" };
      }
      if (!result.ok) {
        setValues((v) => ({ ...v, [column]: before }));
        setError(ERRORS[result.error] ?? ERRORS.not_saved);
      } else {
        setNotes((n) => ({ ...n, [column]: result.ok && result.note ? result.note : "" }));
      }
      setBusy(null);
    });
  }

  return <NotificationPreferencesView values={values} onToggle={onToggle} busy={busy} notes={notes} error={error} optIn={optIn} />;
}
