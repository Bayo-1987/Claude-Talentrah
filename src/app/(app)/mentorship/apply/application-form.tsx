"use client";

import { useActionState } from "react";
import { applyToBecomeMentorAction, updateMentorProfileAction } from "@/lib/mentorship/actions";
import { TextField, Button } from "@/components/ui";
import { MinimalRichEditor } from "@/components/rich-text/minimal-rich-editor";
import type { OwnMentorProfile } from "@/lib/mentorship/queries";
import type { ApplicationFieldErrors, ApplicationFormValues } from "@/lib/mentorship/application-validation";

export interface ApplicationFormState {
  status: "idle" | "success" | "warning" | "error";
  message: string;
  /** Set when the server refused the form: what to fix, field by field. */
  fieldErrors?: ApplicationFieldErrors;
  /** Set with fieldErrors: what was typed, shown again so a refused form does not go blank. */
  values?: ApplicationFormValues;
}

const initialState: ApplicationFormState = { status: "idle", message: "" };

export function ApplicationForm({ existing }: { existing: OwnMentorProfile | null }) {
  const action = existing ? updateMentorProfileAction : applyToBecomeMentorAction;
  const [state, formAction, pending] = useActionState<ApplicationFormState, FormData>(action, initialState);
  return <ApplicationFormView existing={existing} state={state} formAction={formAction} pending={pending} />;
}

/**
 * What each field starts with: what was typed if the server just refused the form, otherwise what is saved, otherwise nothing. A saved null (years, price) is an
 * empty field, never the text "null". Submitting these values unchanged writes exactly what was saved.
 */
export function initialFormValues(existing: OwnMentorProfile | null, typed: ApplicationFormValues | undefined): ApplicationFormValues {
  return {
    displayName: typed?.displayName ?? existing?.displayName ?? "",
    bio: typed?.bio ?? existing?.bio ?? "",
    expertiseRoles: typed?.expertiseRoles ?? existing?.expertiseRoles.join(", ") ?? "",
    expertiseIndustries: typed?.expertiseIndustries ?? existing?.expertiseIndustries.join(", ") ?? "",
    yearsExperience: typed?.yearsExperience ?? (existing?.yearsExperience == null ? "" : String(existing.yearsExperience)),
    basePriceNgn: typed?.basePriceNgn ?? (existing?.basePriceNgn == null ? "" : String(existing.basePriceNgn)),
  };
}

/** The form's markup, separate from the action wiring so what a refused submit looks like can be tested. */
export function ApplicationFormView({
  existing,
  state,
  formAction,
  pending,
}: {
  existing: OwnMentorProfile | null;
  state: ApplicationFormState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const errors = state.fieldErrors ?? {};
  // After a refusal the typed values come back from the server; otherwise the saved ones.
  const initial = initialFormValues(existing, state.status === "error" ? state.values : undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {/*
        The status region is in the page from the first render, empty, and the message goes INTO it: a live region that is inserted already holding text is
        often not announced, one that already exists and then changes is. Polite and atomic, so the whole message is read once. A refusal is announced here
        too; it is not also a role="alert", which would read it twice.
      */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {state.message && (
          <p
            className={`text-[13px] ${
              state.status === "error" ? "text-rust" : state.status === "warning" ? "text-amber" : "text-green"
            }`}
          >
            {state.message}
          </p>
        )}
      </div>

      {/*
        send-418: the name mentees actually see (mentor_public_names' own
        display_name-first preference, queries.ts) — separate from whatever
        was typed into first/last name at ordinary account signup, which for
        two production mentors turned out to be a company/account name
        instead of a person's ("Zimcrest Technologies", "Info Talentrah").
        Required (S1-93): an application with no name was one of the blanks
        the server used to accept.
      */}
      <TextField
        label="Display name (shown to mentees, required)"
        name="displayName"
        defaultValue={initial.displayName}
        placeholder="Your own name — not your company's"
        error={errors.displayName}
      />

      {/*
        send-369, superseded by send-370/371/373's shared minimal-grammar
        stack — a bio is a 1-3 sentence register like a resume summary or a
        screening answer, not a document: bold, italic, no headings/lists/
        quote/rule. `linkable` is bio's own one addition on top of that
        shared stack (a portfolio/LinkedIn link) — see minimal-extensions.ts.
        The editor is not reset by a refused submit, so what was typed stays.
        The error is shown here, not inside the editor, so it also renders
        before the editor has hydrated.
      */}
      <div className="flex flex-col gap-1.5">
        <MinimalRichEditor
          id="bio"
          name="bio"
          label="Bio (required, at least 80 characters)"
          defaultValue={initial.bio}
          linkable
          minHeightClassName="min-h-24"
          describedBy={errors.bio ? "bio-error" : undefined}
          invalid={!!errors.bio}
        />
        {errors.bio && (
          <p id="bio-error" className="text-[12.5px] text-rust">
            {errors.bio}
          </p>
        )}
      </div>

      <TextField
        label="Roles you can speak to (required, comma-separated)"
        name="expertiseRoles"
        defaultValue={initial.expertiseRoles}
        placeholder="Product Manager, Software Engineer"
        error={errors.expertiseRoles}
      />
      <TextField
        label="Industries (optional, comma-separated)"
        name="expertiseIndustries"
        defaultValue={initial.expertiseIndustries}
        placeholder="Fintech, Healthcare"
      />
      <TextField
        label="Years of experience (required, 0 to 60)"
        name="yearsExperience"
        type="number"
        min={0}
        max={60}
        defaultValue={initial.yearsExperience}
        error={errors.yearsExperience}
      />
      <TextField
        label="Price per session, in Naira (leave blank if free/volunteer)"
        name="basePriceNgn"
        type="number"
        min={1}
        defaultValue={initial.basePriceNgn}
        error={errors.basePriceNgn}
      />

      <Button type="submit" variant="primary" disabled={pending}>
        {existing ? "Save changes" : "Submit application"}
      </Button>
    </form>
  );
}
