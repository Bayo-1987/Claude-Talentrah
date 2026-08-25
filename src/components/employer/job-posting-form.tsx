"use client";

import { useActionState } from "react";
import { BorderedCard, Button, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { EmployerActionState } from "@/lib/employer/actions";

/**
 * A select whose option labels differ from their stored values.
 *
 * The shared SelectField renders each option's raw value as its label, which
 * is right for the enums it was built for and wrong for these: the DB stores
 * `full_time`, and "Full_time" is not a thing to show an employer. Kept local
 * rather than widening the shared primitive for one caller.
 */
function ChoiceField({
  label,
  name,
  options,
  defaultValue,
  placeholder = "Not specified",
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="font-body text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        className={cn(
          "min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const WORK_TYPES = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
] as const;

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
] as const;

const SENIORITIES = [
  { value: "entry", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "executive", label: "Executive" },
] as const;

export interface JobFormValues {
  title: string;
  location: string;
  description: string;
  workType: string | null;
  employmentType: string | null;
  seniority: string | null;
  yearsExperienceMin: number | null;
}

export function JobPostingForm({
  action,
  initial,
  submitLabel,
  pendingLabel,
  /** Shown above the form when the org can't publish publicly yet. */
  unverifiedNotice,
}: {
  action: (state: EmployerActionState, form: FormData) => Promise<EmployerActionState>;
  initial?: JobFormValues;
  submitLabel: string;
  pendingLabel: string;
  unverifiedNotice?: string;
}) {
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(action, null);
  const error = state && "error" in state ? state.error : null;

  return (
    <div className="flex flex-col gap-5">
      {unverifiedNotice && (
        <p className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px] text-ink">
          {unverifiedNotice}
        </p>
      )}
      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {error}
        </p>
      )}

      <BorderedCard className="p-6">
        <form action={formAction} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 min-[640px]:grid-cols-2">
            <TextField
              label="Job title"
              name="title"
              required
              defaultValue={initial?.title}
              placeholder="e.g. Backend Engineer (Node.js)"
            />
            <TextField
              label="Location"
              name="location"
              defaultValue={initial?.location}
              placeholder="e.g. Lagos, Nigeria"
            />
            <ChoiceField
              label="Work type"
              name="workType"
              options={WORK_TYPES}
              defaultValue={initial?.workType}
            />
            <ChoiceField
              label="Employment type"
              name="employmentType"
              options={EMPLOYMENT_TYPES}
              defaultValue={initial?.employmentType}
            />
            <ChoiceField
              label="Seniority"
              name="seniority"
              options={SENIORITIES}
              defaultValue={initial?.seniority}
            />
            <TextField
              label="Minimum years of experience"
              name="yearsExperienceMin"
              type="number"
              min={0}
              max={40}
              defaultValue={initial?.yearsExperienceMin ?? undefined}
              placeholder="Optional"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="description"
              className="font-body text-[13px] font-semibold text-ink-soft"
            >
              Job description
            </label>
            <textarea
              id="description"
              name="description"
              required
              rows={14}
              defaultValue={initial?.description}
              placeholder="Responsibilities, requirements, what the team is like, how to stand out."
              className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] leading-[1.65] text-ink outline-none focus:border-rust"
            />
            <p className="font-body text-[12.5px] text-ink-soft">
              This is what seekers are matched against — the more concrete the requirements, the
              better the match scores.
            </p>
          </div>

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </BorderedCard>
    </div>
  );
}
