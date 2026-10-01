import { BorderedCard, Button, TextField, SelectField } from "@/components/ui";
import { addManualEntryAction } from "@/lib/applications/tracker-actions";
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
  return (
    <details className="group">
      <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-2 font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust [&::-webkit-details-marker]:hidden">
        + Add a job you applied to outside Talentrah
      </summary>
      <BorderedCard className="mt-3 p-5">
        <form
          action={addManualEntryAction}
          className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2"
        >
          <TextField label="Company" name="companyName" required />
          <TextField label="Job title" name="title" required />
          <TextField label="Location" name="location" placeholder="e.g. Lagos, Nigeria" />
          <TextField label="Job URL (optional)" name="url" type="url" placeholder="https://" />
          <SelectField
            label="Stage"
            name="stage"
            options={STAGE_OPTIONS}
            defaultValue="saved"
          />
          <div className="min-[640px]:col-span-2">
            <TextField label="Notes (optional)" name="notes" />
          </div>
          <div className="min-[640px]:col-span-2">
            <Button type="submit" size="sm">
              Add to tracker
            </Button>
          </div>
        </form>
      </BorderedCard>
    </details>
  );
}
