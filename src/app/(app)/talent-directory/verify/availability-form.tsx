"use client";

import { useActionState } from "react";
import { updateAvailabilityAction } from "@/lib/talent-directory/actions";
import { Button } from "@/components/ui";

const initialState: { status: "idle" | "success" | "error"; message: string } = {
  status: "idle",
  message: "",
};

export function AvailabilityForm({
  availableForHire,
  remoteReady,
  earliestStartDate,
}: {
  availableForHire: boolean;
  remoteReady: boolean;
  earliestStartDate: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateAvailabilityAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
        <input type="checkbox" name="availableForHire" defaultChecked={availableForHire} className="h-4 w-4" />
        Open to new opportunities
      </label>
      <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
        <input type="checkbox" name="remoteReady" defaultChecked={remoteReady} className="h-4 w-4" />
        Ready to work remote
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="earliestStartDate" className="font-body text-[13px] font-semibold text-ink-soft">
          Earliest start date (optional)
        </label>
        <input
          id="earliestStartDate"
          name="earliestStartDate"
          type="date"
          defaultValue={earliestStartDate ?? ""}
          className="min-h-11 max-w-[220px] border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink"
        />
      </div>
      {state.message && (
        <p className={`text-[13px] ${state.status === "error" ? "text-rust" : "text-green"}`}>{state.message}</p>
      )}
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
