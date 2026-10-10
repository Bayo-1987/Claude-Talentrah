"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { savedSelect } from "@/lib/forms/saved-select";
import Link from "next/link";
import { updateScholarshipAction } from "@/lib/scholarships/admin-edit-action";
import { initialEditScholarshipState } from "@/lib/scholarships/admin-edit-state";
import { inputList, inputValue } from "@/lib/forms/keep-input";
import { PUBLISHED_EDIT_WARNING } from "@/lib/scholarships/admin-edit-constants";
import { DEGREE_LEVEL_LABEL, DEGREE_LEVEL_VALUES, FUNDING_TYPE_LABEL, FUNDING_TYPE_VALUES } from "@/lib/scholarships/types";
import { noteCounter } from "@/lib/scholarships/public-deadline-note";
import { TextField, SelectField, Button, EyebrowLabel, BorderedCard } from "@/components/ui";
import { MinimalRichEditor } from "@/components/rich-text/minimal-rich-editor";
import { TextArea } from "@/components/ui/text-area";

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

/**
 * Edit a scholarship listing (owner, 8 Oct 2026): the add-by-hand form's fields, pre-filled. For a PUBLISHED listing the warning is shown BEFORE the operator saves.
 *
 * An error keeps what was typed through the shared helper (src/lib/forms/keep-input.ts): the action hands the submitted values back with every error and each field uses them as its default,
 * falling back to the stored value. A save redirects, so there is no state to carry over.
 */
export function EditScholarshipForm({ id, published, initial }: { id: string; published: boolean; initial: EditInitial }) {
  const [state, formAction, pending] = useActionState(updateScholarshipAction.bind(null, id), initialEditScholarshipState);
  const fundingSelect = savedSelect("fundingType", initial.fundingType, state.values);
  const [noteLength, setNoteLength] = useState(initial.deadlineNote.trim().length);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    setNoteLength((state.values?.deadlineNote ?? initial.deadlineNote).trim().length); // the form was reset: the counter follows the field
  }
  const counter = noteCounter(noteLength);

  // The banner is at the top of a long form and Save is at the bottom: bring a refused save into view.
  const bannerRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "idle") return;
    bannerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  return (
    <BorderedCard className="max-w-[720px] p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <EyebrowLabel>Edit listing</EyebrowLabel>

        {published && (
          <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] font-semibold text-rust" role="note">
            {PUBLISHED_EDIT_WARNING}
          </p>
        )}
        {state.status === "error" && state.error && (
          <p ref={bannerRef} className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust" role="alert">
            {state.error}
          </p>
        )}

        <TextField label="Provider" name="provider" defaultValue={inputValue(state.values, "provider", initial.provider)} required error={state.fieldErrors?.provider?.[0]} />
        <TextField label="Programme name" name="programName" defaultValue={inputValue(state.values, "programName", initial.programName)} required error={state.fieldErrors?.programName?.[0]} />
        <TextField label="Host institution (optional)" name="hostInstitution" defaultValue={inputValue(state.values, "hostInstitution", initial.hostInstitution)} error={state.fieldErrors?.hostInstitution?.[0]} />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-body text-[13px] font-semibold text-ink-soft">Degree levels</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {DEGREE_LEVEL_VALUES.map((value) => (
              <label key={value} className="inline-flex min-h-10 items-center gap-2 font-body text-[14px] text-ink">
                <input type="checkbox" name="degreeLevels" value={value} defaultChecked={(state.values ? inputList(state.values, "degreeLevels") : initial.degreeLevels).includes(value)} className="h-4 w-4 accent-[oklch(52%_0.14_40)]" />
                {DEGREE_LEVEL_LABEL[value]}
              </label>
            ))}
          </div>
          {state.fieldErrors?.degreeLevels?.[0] && <p className="text-[12.5px] text-rust">{state.fieldErrors.degreeLevels[0]}</p>}
        </fieldset>

        <SelectField key={fundingSelect.key} label="Funding" name="fundingType" options={FUNDING_OPTIONS} defaultValue={fundingSelect.defaultValue} required error={state.fieldErrors?.fundingType?.[0]} />
        <TextField label="What it covers (comma-separated)" name="fundingCovers" defaultValue={inputValue(state.values, "fundingCovers", initial.fundingCovers)} error={state.fieldErrors?.fundingCovers?.[0]} />
        <TextField label="Field tags (comma-separated)" name="fieldTags" defaultValue={inputValue(state.values, "fieldTags", initial.fieldTags)} error={state.fieldErrors?.fieldTags?.[0]} />
        <TextField label="Eligible nationalities (comma-separated)" name="eligibilityNationalities" defaultValue={inputValue(state.values, "eligibilityNationalities", initial.eligibilityNationalities)} error={state.fieldErrors?.eligibilityNationalities?.[0]} />
        <TextField label="Prior degree required (optional)" name="eligibilityPriorDegree" defaultValue={inputValue(state.values, "eligibilityPriorDegree", initial.eligibilityPriorDegree)} error={state.fieldErrors?.eligibilityPriorDegree?.[0]} />
        <TextField label="Age requirement (optional)" name="eligibilityAge" defaultValue={inputValue(state.values, "eligibilityAge", initial.eligibilityAge)} error={state.fieldErrors?.eligibilityAge?.[0]} />

        <MinimalRichEditor
          id="eligibilityOther"
          name="eligibilityOther"
          label="Other eligibility notes (optional)"
          defaultValue={inputValue(state.values, "eligibilityOther", initial.eligibilityOther)}
          minHeightClassName="min-h-[76px]"
        />

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[200px] flex-1">
            <TextField label="Deadline (YYYY-MM-DD, optional)" name="applicationDeadline" defaultValue={inputValue(state.values, "applicationDeadline", initial.applicationDeadline)} placeholder="2026-03-31" error={state.fieldErrors?.applicationDeadline?.[0]} />
          </div>
          <div className="min-w-[140px] flex-1">
            <TextField label="Cycle year (optional)" name="cycleYear" defaultValue={inputValue(state.values, "cycleYear", initial.cycleYear)} placeholder="2026" error={state.fieldErrors?.cycleYear?.[0]} />
          </div>
        </div>

        <TextField
          label="Deadline note — shown when there's no single date"
          name="deadlineNote"
          defaultValue={inputValue(state.values, "deadlineNote", initial.deadlineNote)}
          placeholder="Varies by partner institution"
          onChange={(e) => setNoteLength(e.target.value.trim().length)}
          error={state.fieldErrors?.deadlineNote?.[0]}
        />
        <p aria-live="polite" className={counter.over ? "-mt-3 text-[12.5px] font-semibold text-rust" : "-mt-3 text-[12.5px] text-ink-soft"}>
          {counter.text}
        </p>

        <TextField label="Official source URL" name="officialUrl" type="url" defaultValue={inputValue(state.values, "officialUrl", initial.officialUrl)} required error={state.fieldErrors?.officialUrl?.[0]} />
        <TextField label="Source name" name="sourceName" defaultValue={inputValue(state.values, "sourceName", initial.sourceName)} error={state.fieldErrors?.sourceName?.[0]} />

        <TextArea label="Reviewer note (optional) — what you changed or checked" id="reviewNote" name="reviewNote" defaultValue={inputValue(state.values, "reviewNote", initial.reviewNote)} />

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
