"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { TextArea } from "@/components/ui/text-area";
import { ADMIN_MESSAGE_KINDS, ADMIN_SEGMENT_KEYS, NOTIFICATION_LIMITS } from "@/lib/notifications/contract";
import { initialMessageActionState } from "./state";
import type { MessageAction } from "./action-form";
import { CONSENT_LINE_HELP, CONSENT_LINE_SAMPLES, KIND_HELP, KIND_LABEL, QUIET_HOURS_SENTENCE, switchedOffReason } from "./texts";

const SEGMENT_LABEL: Record<string, string> = {
  everyone: "Everyone",
  seekers: "Job seekers",
  employers: "Employers",
  verified_employers: "Verified employers",
  inactive_seekers: "Job seekers who have not visited lately",
  signed_up_since: "People who signed up since a date",
  country: "People in one country",
  self_test: "Only me (a test)",
};

const box = "min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink";
const lab = "flex flex-col gap-1.5 text-[13px] font-semibold text-ink-soft";

export function ComposeForm({ action, promotionsOn, emailOn }: { action: MessageAction; promotionsOn: boolean; emailOn: boolean }) {
  const [state, run, pending] = useActionState(action, initialMessageActionState);
  return (
    <form action={run} className="flex max-w-[640px] flex-col gap-5">
      <label className={lab}>
        Kind
        <select name="kind" className={box} defaultValue="service_announcement">
          {ADMIN_MESSAGE_KINDS.map((k) => (
            <option key={k} value={k} disabled={k === "promotion" && !promotionsOn}>
              {KIND_LABEL[k]}
              {k === "promotion" && !promotionsOn ? " (switched off)" : ""}
            </option>
          ))}
        </select>
      </label>
      <ul className="-mt-2 flex list-none flex-col gap-1 p-0 text-[13px] text-ink-soft">
        {ADMIN_MESSAGE_KINDS.map((k) => (
          <li key={k}>{KIND_HELP[k]}</li>
        ))}
      </ul>
      {!promotionsOn && <p className="text-[13px] text-ink-soft">{switchedOffReason("promotions")}</p>}
      <label className={lab}>
        Title ({NOTIFICATION_LIMITS.titleMaxLength} characters at most)
        <input name="title" maxLength={NOTIFICATION_LIMITS.titleMaxLength} required className={box} />
      </label>
      <TextArea label={`Message (${NOTIFICATION_LIMITS.bodyMaxLength} characters at most)`} name="body" limit={NOTIFICATION_LIMITS.bodyMaxLength} minRows={6} required />
      <label className={lab}>
        Link on this site (optional, for example /jobs)
        <input name="linkPath" placeholder="/jobs" className={box} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold text-ink-soft">Channels</legend>
        <label className="flex items-center gap-3 text-[14.5px]"><input type="checkbox" name="channels" value="inapp" defaultChecked /> In the app</label>
        <label className="flex items-center gap-3 text-[14.5px]"><input type="checkbox" name="channels" value="push" /> Push notification</label>
        <p data-testid="quiet-hours" className="ml-8 text-[13px] text-ink-soft">{QUIET_HOURS_SENTENCE}</p>
        <label className="flex items-center gap-3 text-[14.5px]"><input type="checkbox" name="channels" value="email" disabled={!emailOn} /> Email{emailOn ? "" : " (switched off)"}</label>
        {!emailOn && <p className="ml-8 text-[13px] text-ink-soft">{switchedOffReason("email")}</p>}
      </fieldset>
      <label className={lab}>
        Audience
        <select name="segmentKey" className={box} defaultValue="self_test">
          {ADMIN_SEGMENT_KEYS.map((k) => <option key={k} value={k}>{SEGMENT_LABEL[k] ?? k}</option>)}
        </select>
      </label>
      <label className={lab}>
        Days since last visit (only for “not visited lately”)
        <select name="segmentDays" className={box} defaultValue="30"><option value="30">30</option><option value="60">60</option><option value="90">90</option></select>
      </label>
      <label className={lab}>Date (only for “signed up since”)<input name="segmentSince" type="date" className={box} /></label>
      <label className={lab}>Country (only for “one country”)<input name="segmentCountry" className={box} /></label>
      <label className={lab}>
        Consent line (required for a promotion)
        <input name="consentLine" className={box} />
      </label>
      <div className="-mt-3 flex flex-col gap-1 text-[13px] text-ink-soft">
        <p>{CONSENT_LINE_HELP}</p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 italic">
          {CONSENT_LINE_SAMPLES.map((sample) => (
            <li key={sample}>{sample}</li>
          ))}
        </ul>
      </div>
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save as a draft"}</Button></div>
      {state.status === "error" && <p role="status" className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">{state.message}</p>}
    </form>
  );
}
