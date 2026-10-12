"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TextArea } from "@/components/ui/text-area";
import { createInterviewOfferAction, interviewOverlapWarningsAction, type OverlapWarning } from "@/lib/interviews/actions";
import { INTERVIEW_KINDS, KIND_LABELS, MAX_DURATION, MAX_SLOTS, MIN_DURATION, MIN_SLOTS, NOTE_MAX, type InterviewKind } from "@/lib/interviews/constants";

const toIso = (local: string): string | null => {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Offer 2 to 5 times. The employer types times in their own clock (the browser converts them to UTC, which is what is stored and what the candidate's page converts back to THEIR clock), picks a
 * length, a kind and an optional note. While they pick, any time that overlaps an interview already booked for the organisation is flagged: a warning only, it never stops the offer.
 */
export function ScheduleInterviewForm({ jobId, applicationId, candidateName, orgVerified }: { jobId: string; applicationId: string; candidateName: string; orgVerified: boolean }) {
  const router = useRouter();
  const [times, setTimes] = useState<string[]>(["", ""]);
  const [duration, setDuration] = useState(45);
  const [kind, setKind] = useState<InterviewKind>("video");
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<OverlapWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const checkId = useRef(0);

  const isos = times.map(toIso);
  const filled = isos.filter((v): v is string => v !== null);
  const key = JSON.stringify([filled, duration]);

  useEffect(() => {
    if (filled.length < MIN_SLOTS) return;
    const id = ++checkId.current;
    const handle = setTimeout(async () => {
      const result = await interviewOverlapWarningsAction({ jobId, applicationId, times: filled, durationMinutes: duration }).catch(() => []);
      if (id === checkId.current) setWarnings(result);
    }, 500);
    return () => clearTimeout(handle);
    // `key` carries the filled times and the length; the other inputs do not change the question asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, jobId, applicationId]);

  // Warnings are only meaningful while there are enough times to ask about; with fewer, any earlier answer is not shown.
  const warningFor = (isoIndex: number) => (filled.length >= MIN_SLOTS ? warnings.find((w) => w.slotIndex === isoIndex) : undefined);

  function submit() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createInterviewOfferAction({ jobId, applicationId, kind, note, times: filled, durationMinutes: duration });
        if (result.ok) {
          router.refresh();
        } else {
          setError(result.error);
          // The offer may exist even though the email failed: show the page's current state.
          if (result.offerId) router.refresh();
        }
      } catch {
        setError("Couldn't reach Talentrah. Check your connection and try again: what you entered is still here.");
      } finally {
        busy.current = false;
      }
    });
  }

  const canSubmit = orgVerified && filled.length >= MIN_SLOTS && filled.length === times.filter(Boolean).length && !pending;

  return (
    <div className="border-[1.5px] border-ink bg-card p-6 sm:p-8">
      <h2 className="font-display text-[24px] leading-[1.15] font-medium text-ink">Offer interview times to {candidateName}</h2>
      <p className="mt-2 max-w-[62ch] font-body text-[14px] text-ink-soft">
        Offer {MIN_SLOTS} to {MAX_SLOTS} times in your own clock. {candidateName} picks one on Talentrah and sees it in their own time zone. Each invitation counts toward your 20 messages and invitations a day.
      </p>

      {!orgVerified && (
        <p role="status" className="mt-5 border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 font-body text-[13.5px] text-ink">
          <span className="font-semibold">Verify your company first.</span> Invitations are sent from Talentrah, so only verified companies can send them.
        </p>
      )}

      <fieldset className="mt-6 flex flex-col gap-3">
        <legend className="font-body text-[13px] font-semibold text-ink">Times</legend>
        {times.map((value, i) => {
          const isoIndex = filled.findIndex((iso) => iso === isos[i]);
          const warning = value && isoIndex >= 0 ? warningFor(isoIndex) : undefined;
          return (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <input
                  type="datetime-local"
                  aria-label={`Time ${i + 1}`}
                  value={value}
                  onChange={(e) => setTimes((t) => t.map((v, j) => (j === i ? e.target.value : v)))}
                  className="min-h-11 border-[1.5px] border-ink bg-card px-3 font-body text-[15px] text-ink outline-none focus:border-rust"
                />
                {times.length > MIN_SLOTS && (
                  <button type="button" onClick={() => setTimes((t) => t.filter((_, j) => j !== i))} className="min-h-11 px-2 font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust">
                    Remove
                  </button>
                )}
              </div>
              {warning && (
                <p role="note" className="font-body text-[13px] text-rust">
                  This time overlaps a booked interview for {warning.jobTitle}. You can still offer it.
                </p>
              )}
            </div>
          );
        })}
        {times.length < MAX_SLOTS && (
          <button type="button" onClick={() => setTimes((t) => [...t, ""])} className="min-h-11 self-start font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust">
            Add another time
          </button>
        )}
      </fieldset>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 font-body text-[13px] font-semibold text-ink">
          Length
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="min-h-11 border-[1.5px] border-ink bg-card px-3 font-body text-[15px] font-normal text-ink outline-none focus:border-rust">
            {[15, 30, 45, 60, 90, 120].filter((m) => m >= MIN_DURATION && m <= MAX_DURATION).map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 font-body text-[13px] font-semibold text-ink">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as InterviewKind)} className="min-h-11 border-[1.5px] border-ink bg-card px-3 font-body text-[15px] font-normal text-ink outline-none focus:border-rust">
            {INTERVIEW_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <TextArea
        id="interview-note"
        label={`Note for ${candidateName} (optional)`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        limit={NOTE_MAX}
        counterFrom={Math.floor(NOTE_MAX * 0.75)}
        placeholder="A video link, an address, or what to prepare."
        wrapperClassName="mt-5"
      />

      {error && (
        <p role="alert" className="mt-5 border-[1.5px] border-rust bg-rust-soft px-4 py-3 font-body text-[13.5px] text-rust">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={submit} disabled={!canSubmit} className="min-h-12 bg-ink px-7 font-body text-[15px] font-semibold text-paper hover:bg-rust disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </div>
  );
}
