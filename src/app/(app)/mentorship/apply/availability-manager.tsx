"use client";

import { useState, useTransition } from "react";
import { postAvailabilitySlotAction, deleteAvailabilitySlotAction } from "@/lib/mentorship/actions";
import { Button, Card } from "@/components/ui";
import type { MentorAvailabilitySlot } from "@/lib/mentorship/queries";

export function AvailabilityManager({ slots }: { slots: MentorAvailabilitySlot[] }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-display text-[18px] font-semibold">Your open slots</h2>

      {slots.length === 0 ? (
        <p className="text-[13.5px] text-ink-soft">No open slots posted.</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {slots.map((slot) => (
            <li key={slot.id} className="flex items-center justify-between gap-3 border-b border-line pb-2">
              <span className="text-[13.5px] text-ink">
                {new Date(slot.startAt).toLocaleString()} – {new Date(slot.endAt).toLocaleTimeString()}
              </span>
              <button
                type="button"
                onClick={() => startTransition(() => deleteAvailabilitySlotAction(slot.id))}
                className="font-body text-[12.5px] font-semibold text-coral"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!start || !end) return;
          if (new Date(end) <= new Date(start)) {
            setError("End time must be after start time.");
            return;
          }
          setError(null);
          startTransition(async () => {
            await postAvailabilitySlotAction(new Date(start).toISOString(), new Date(end).toISOString());
            setStart("");
            setEnd("");
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-[12.5px] font-semibold text-ink-soft">Start</label>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className="min-h-10 border-[1.5px] border-ink bg-card px-2.5 font-body text-[13.5px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-[12.5px] font-semibold text-ink-soft">End</label>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            className="min-h-10 border-[1.5px] border-ink bg-card px-2.5 font-body text-[13.5px]"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Add slot
        </Button>
      </form>
      {error && <p className="text-[12.5px] text-coral">{error}</p>}
    </Card>
  );
}
