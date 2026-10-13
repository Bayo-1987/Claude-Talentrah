"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookInterviewSlotAction, noneOfTheseTimesWorkAction } from "@/lib/interviews/actions";
import { viewerTimeZone } from "@/lib/format/datetime";
import { LocalTime } from "./local-time";

type Slot = { id: string; startsAt: string; durationMinutes: number };

const browserZone = (): string => viewerTimeZone() ?? "UTC";

/** The candidate's side: pick one offered time (each shown in THEIR zone), or say none of them work. The loser of a race is told "That time was just taken" and the page refreshes to the remaining times. */
export function InterviewPicker({ offerId, slots }: { offerId: string; slots: Slot[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  function book(slotId: string) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await bookInterviewSlotAction({ slotId, timeZone: browserZone() });
        if (result.ok) {
          router.refresh();
        } else {
          setError(result.error);
          router.refresh();
        }
      } catch {
        setError("Couldn't reach Talentrah. Check your connection and try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  function none() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await noneOfTheseTimesWorkAction({ offerId });
        if (result.ok) setSaid(true);
        else setError(result.error);
      } catch {
        setError("Couldn't reach Talentrah. Check your connection and try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {slots.map((slot) => (
          <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-ink bg-card px-4 py-3">
            <span className="font-body text-[15px] text-ink">
              <LocalTime startsAt={slot.startsAt} durationMinutes={slot.durationMinutes} />
            </span>
            <button type="button" onClick={() => book(slot.id)} disabled={pending} className="min-h-11 bg-ink px-6 font-body text-[14px] font-semibold text-paper hover:bg-rust disabled:cursor-not-allowed disabled:opacity-50">
              Book this time
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 font-body text-[13.5px] text-rust">
          {error}
        </p>
      )}
      {said ? (
        <p role="status" className="font-body text-[14px] text-ink">
          Thanks. We&apos;ve told them none of these times work. You can still book one of them here if something changes.
        </p>
      ) : (
        <button type="button" onClick={none} disabled={pending} className="min-h-11 self-start font-body text-[14px] font-semibold text-ink underline underline-offset-2 hover:text-rust disabled:opacity-50">
          None of these work
        </button>
      )}
    </div>
  );
}
