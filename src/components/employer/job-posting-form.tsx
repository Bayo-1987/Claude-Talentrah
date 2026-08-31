"use client";

import { useActionState, useState } from "react";
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

/**
 * How long the posting should stay open.
 *
 * ── THE WORD "CLOSES" IS A PROMISE, AND IT IS KEPT ────────────────────────
 *
 * `expires_at` was inert when 0053 added it — set by ingestion, read by
 * nothing. Offering it here changes that: an employer who picks "30 days" is
 * told "Closes 30 September", and a control that says so while the posting
 * runs forever would be worse than no control. src/lib/jobs/expiry.ts is what
 * makes the sentence true.
 *
 * One honest imprecision: the sweep rides the 05:00 ingest cron, so a posting
 * that expires during the day actually closes at the next run — up to a day
 * late. The copy says a date rather than a time for that reason; promising an
 * hour would be a precision the schedule does not have.
 *
 * ── PRESETS, NOT A DATE PICKER ────────────────────────────────────────────
 *
 * An employer thinks in durability — "run this for a month" — not in calendar
 * arithmetic, and a raw date input invites the two failures a preset cannot
 * have: a date in the past, and a typo three years out. Every option here is
 * computed forward from now, so a past expiry is unreachable by construction
 * rather than by validation.
 *
 * The concrete date is shown once a preset is chosen, because "30 days" and
 * "expires 30 September" are different amounts of information and the second
 * is the one that gets checked against a hiring plan.
 *
 * ── DEFAULT IS NO EXPIRY ──────────────────────────────────────────────────
 *
 * 0053 added `expires_at` with no default on purpose: "a default is a guess
 * recorded as if a source had stated it". The same reasoning holds here — an
 * employer who does not choose has not said their role closes, and inventing
 * a date on their behalf would eventually take a live posting down.
 */
const EXPIRY_PRESETS = [
  { value: "14", label: "2 weeks", days: 14 },
  { value: "30", label: "30 days", days: 30 },
  { value: "60", label: "60 days", days: 60 },
] as const;

function formatExpiry(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function ExpiryField({ current }: { current: string | null }) {
  // "keep" only exists while editing a posting that already has an expiry —
  // remapping a stored date onto the nearest preset would silently move it.
  const [choice, setChoice] = useState(current ? "keep" : "");
  const preset = EXPIRY_PRESETS.find((p) => p.value === choice);
  const currentLabel = current
    ? new Date(current).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="expiresIn" className="font-body text-[13px] font-semibold text-ink-soft">
        Closes
      </label>
      <select
        id="expiresIn"
        name="expiresIn"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className={cn(
          "min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust",
        )}
      >
        {currentLabel && <option value="keep">Keep current — {currentLabel}</option>}
        <option value="">No expiry</option>
        {EXPIRY_PRESETS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="text-[12.5px] text-ink-soft">
        {preset
          ? `Closes ${formatExpiry(preset.days)}.`
          : choice === "keep" && currentLabel
            ? `Closes ${currentLabel}. Choose a duration to change it, or “No expiry” to remove it.`
            : "Stays open until you close it."}
      </p>
    </div>
  );
}

export interface JobFormValues {
  title: string;
  location: string;
  description: string;
  workType: string | null;
  employmentType: string | null;
  seniority: string | null;
  yearsExperienceMin: number | null;
  /** ISO timestamp, or null. Null means the posting does not expire. */
  expiresAt: string | null;
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
            <ExpiryField current={initial?.expiresAt ?? null} />
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
