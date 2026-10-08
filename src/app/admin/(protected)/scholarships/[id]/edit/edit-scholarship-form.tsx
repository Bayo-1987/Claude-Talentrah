"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { updateScholarshipAction } from "@/lib/scholarships/admin-edit-action";
import { initialEditScholarshipState } from "@/lib/scholarships/admin-edit-state";
import { PUBLISHED_EDIT_WARNING } from "@/lib/scholarships/admin-edit-constants";
import { DEGREE_LEVEL_VALUES, FUNDING_TYPE_VALUES } from "@/lib/scholarships/schemas";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL } from "@/lib/scholarships/types";
import { noteCounter } from "@/lib/scholarships/public-deadline-note";
import { TextField, SelectField, Button, EyebrowLabel, BorderedCard } from "@/components/ui";
import { MinimalRichEditor } from "@/components/rich-text/minimal-rich-editor";

/** The stored listing as the form's text values. */
export interface EditInitial {
  provider: string;
  programName: string;
  hostInstitution: string;
  degreeLevels: string[];
  fieldTags: string;
  fundingType: string;
  fundingCovers: string;
  eligibilityNationalities: string;
  eligibilityPriorDegree: string;
  eligibilityAge: string;
  eligibilityOther: string;
  applicationDeadline: string;
  cycleYear: string;
  officialUrl: string;
  sourceName: string;
  deadlineNote: string;
  reviewNote: string;
}

const FUNDING_OPTIONS = FUNDING_TYPE_VALUES.map((value) => ({ value, label: FUNDING_TYPE_LABEL[value] }));
const AREA_CLASS =
  "border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none placeholder:font-display placeholder:text-[14px] placeholder:italic placeholder:text-ink-soft focus:border-rust";

/**
 * Edit a scholarship listing (owner, 8 Oct 2026): the add-by-hand form's fields, pre-filled. For a PUBLISHED listing the warning is shown BEFORE the operator saves.
 *
 * It submits through its own handler, not the form `action` prop: React 19 resets an uncontrolled form after an action settles, which would throw away what the operator typed
 * when a save is refused (a deadline note with no verified deadline, a bad date). Calling the action from `onSubmit` leaves the fields as they were.
 */
export function EditScholarshipForm({ id, published, initial }: { id: string; published: boolean; initial: EditInitial }) {
  const [state, formAction, pending] = useActionState(updateScholarshipAction.bind(null, id), initialEditScholarshipState);
  const [noteLength, setNoteLength] = useState(initial.deadlineNote.trim().length);
  const counter = noteCounter(noteLength);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <BorderedCard className="max-w-[720px] p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <EyebrowLabel>Edit listing</EyebrowLabel>

        {published && (
          <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] font-semibold text-rust" role="note">
            {PUBLISHED_EDIT_WARNING}
          </p>
        )}
        {state.status === "error" && state.error && (
          <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust" role="alert">
            {state.error}
          </p>
        )}

        <TextField label="Provider" name="provider" defaultValue={initial.provider} required error={state.fieldErrors?.provider?.[0]} />
        <TextField label="Programme name" name="programName" defaultValue={initial.programName} required error={state.fieldErrors?.programName?.[0]} />
        <TextField label="Host institution (optional)" name="hostInstitution" defaultValue={initial.hostInstitution} error={state.fieldErrors?.hostInstitution?.[0]} />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-body text-[13px] font-semibold text-ink-soft">Degree levels</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {DEGREE_LEVEL_VALUES.map((value) => (
              <label key={value} className="inline-flex min-h-10 items-center gap-2 font-body text-[14px] text-ink">
                <input type="checkbox" name="degreeLevels" value={value} defaultChecked={initial.degreeLevels.includes(value)} className="h-4 w-4 accent-[oklch(52%_0.14_40)]" />
                {DEGREE_LEVEL_LABEL[value]}
              </label>
            ))}
          </div>
          {state.fieldErrors?.degreeLevels?.[0] && <p className="text-[12.5px] text-rust">{state.fieldErrors.degreeLevels[0]}</p>}
        </fieldset>

        <SelectField label="Funding" name="fundingType" options={FUNDING_OPTIONS} defaultValue={initial.fundingType} required error={state.fieldErrors?.fundingType?.[0]} />
        <TextField label="What it covers (comma-separated)" name="fundingCovers" defaultValue={initial.fundingCovers} error={state.fieldErrors?.fundingCovers?.[0]} />
        <TextField label="Field tags (comma-separated)" name="fieldTags" defaultValue={initial.fieldTags} error={state.fieldErrors?.fieldTags?.[0]} />
        <TextField label="Eligible nationalities (comma-separated)" name="eligibilityNationalities" defaultValue={initial.eligibilityNationalities} error={state.fieldErrors?.eligibilityNationalities?.[0]} />
        <TextField label="Prior degree required (optional)" name="eligibilityPriorDegree" defaultValue={initial.eligibilityPriorDegree} error={state.fieldErrors?.eligibilityPriorDegree?.[0]} />
        <TextField label="Age requirement (optional)" name="eligibilityAge" defaultValue={initial.eligibilityAge} error={state.fieldErrors?.eligibilityAge?.[0]} />

        <MinimalRichEditor
          id="eligibilityOther"
          name="eligibilityOther"
          label="Other eligibility notes (optional)"
          defaultValue={initial.eligibilityOther}
          minHeightClassName="min-h-[76px]"
        />

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[200px] flex-1">
            <TextField label="Deadline (YYYY-MM-DD, optional)" name="applicationDeadline" defaultValue={initial.applicationDeadline} placeholder="2026-03-31" error={state.fieldErrors?.applicationDeadline?.[0]} />
          </div>
          <div className="min-w-[140px] flex-1">
            <TextField label="Cycle year (optional)" name="cycleYear" defaultValue={initial.cycleYear} placeholder="2026" error={state.fieldErrors?.cycleYear?.[0]} />
          </div>
        </div>

        <TextField
          label="Deadline note — shown when there's no single date"
          name="deadlineNote"
          defaultValue={initial.deadlineNote}
          placeholder="Varies by partner institution"
          onChange={(e) => setNoteLength(e.target.value.trim().length)}
          error={state.fieldErrors?.deadlineNote?.[0]}
        />
        <p aria-live="polite" className={counter.over ? "-mt-3 text-[12.5px] font-semibold text-rust" : "-mt-3 text-[12.5px] text-ink-soft"}>
          {counter.text}
        </p>

        <TextField label="Official source URL" name="officialUrl" type="url" defaultValue={initial.officialUrl} required error={state.fieldErrors?.officialUrl?.[0]} />
        <TextField label="Source name" name="sourceName" defaultValue={initial.sourceName} error={state.fieldErrors?.sourceName?.[0]} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reviewNote" className="font-body text-[13px] font-semibold text-ink-soft">
            Reviewer note (optional) — what you changed or checked
          </label>
          <textarea id="reviewNote" name="reviewNote" rows={3} defaultValue={initial.reviewNote} className={AREA_CLASS} />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Link href="/admin/scholarships" className="inline-flex min-h-10 items-center font-body text-[14px] text-ink underline underline-offset-2">
            Cancel
          </Link>
        </div>
      </form>
    </BorderedCard>
  );
}
