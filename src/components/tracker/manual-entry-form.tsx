"use client";

import { useActionState } from "react";
import { BorderedCard, Button, TextField, SelectField } from "@/components/ui";
import { addManualEntryAction } from "@/lib/applications/tracker-actions";
import { initialTrackerActionState } from "@/lib/applications/tracker-state";
import { inputValue, selectKey } from "@/lib/forms/keep-input";
import { TRACKER_STAGES } from "@/lib/tracker/stages";

/**
 * The tracker's one stage list, with real labels. This used to be six lowercase strings capitalised by CSS and
 * missing Hired. A manually added Hired entry is backfilled history: addManualEntryAction sends no hired-moment
 * email for it (that flow belongs to moving an application to Hired, in updateStageAction).
 */
const STAGE_OPTIONS = TRACKER_STAGES.map((s) => ({ value: s.key, label: s.label }));

/**
 * Native <details>/<summary> disclosure — no client JS needed to expand
 * this, matching the rest of the app's server-rendered-first approach
 * (build-prompt §8's low-bandwidth NFR).
 */
export function ManualEntryForm() {
  const [state, formAction, pending] = useActionState(addManualEntryAction, initialTrackerActionState);
  // A refused add hands the typed values back and React 19 resets the form after the action, so those are the defaults (an error keeps what was typed; a success returns none and the form starts clean).
  const values = state.values;
  return (
    <details className="group" open={state.status === "error" ? true : undefined}>
      <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-2 font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust [&::-webkit-details-marker]:hidden">
        + Add a job you applied to outside Talentrah
      </summary>
      <BorderedCard className="mt-3 p-5">
        <form
          action={formAction}
          className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2"
        >
          {state.status !== "idle" && state.message && (
            <p
              role={state.status === "error" ? "alert" : "status"}
              className={
                "border-[1.5px] px-3.5 py-2.5 text-[13.5px] min-[640px]:col-span-2 " +
                (state.status === "error" ? "border-rust bg-rust-soft text-rust" : "border-ink bg-card text-ink")
              }
            >
              {state.message}
            </p>
          )}
          <TextField label="Company" name="companyName" required defaultValue={inputValue(values, "companyName")} />
          <TextField label="Job title" name="title" required defaultValue={inputValue(values, "title")} />
          <TextField label="Location" name="location" placeholder="e.g. Lagos, Nigeria" defaultValue={inputValue(values, "location")} />
          <TextField label="Job URL (optional)" name="url" type="url" placeholder="https://" defaultValue={inputValue(values, "url")} />
          <SelectField
            key={selectKey(values, "stage")}
            label="Stage"
            name="stage"
            options={STAGE_OPTIONS}
            defaultValue={inputValue(values, "stage", null, "saved")}
          />
          <div className="min-[640px]:col-span-2">
            <TextField label="Notes (optional)" name="notes" defaultValue={inputValue(values, "notes")} />
          </div>
          <div className="min-[640px]:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adding…" : "Add to tracker"}
            </Button>
          </div>
        </form>
      </BorderedCard>
    </details>
  );
}
