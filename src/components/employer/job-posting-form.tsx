"use client";

import { useActionState, useState } from "react";
import { MAX_EXPIRY_DAYS } from "@/lib/employer/expiry-input";
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

const SALARY_UNITS = [
  { value: "hour", label: "Per hour" },
  { value: "day", label: "Per day" },
  { value: "week", label: "Per week" },
  { value: "month", label: "Per month" },
  { value: "year", label: "Per year" },
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
 * ── PRESETS FIRST, AND A BOUNDED CUSTOM DATE ──────────────────────────────
 *
 * This was presets-only, and the reason still holds: an employer thinks in
 * duration — "run this for a month" — not in calendar arithmetic, and an
 * unbounded date input invites the two failures a preset cannot have, a date
 * in the past and a typo three years out. Presets remain the default path and
 * are still posted as a NUMBER OF DAYS, never a date, so the server computes
 * the timestamp from its own `now`.
 *
 * A custom date was asked for, and it is added WITHOUT giving up either
 * guarantee, rather than by dropping the argument above:
 *
 *   PAST DATES        `min` is tomorrow, so a past date is not selectable —
 *                     and the server independently refuses anything at or
 *                     before `now`, because `min` is a courtesy to the person
 *                     filling the form and not a control over what is posted.
 *   ABSURD FUTURES    `max` is MAX_EXPIRY_DAYS ahead, the same 365-day bound
 *                     the preset path already enforced, re-checked server-side.
 *
 * So the two failure modes stay unreachable; what changes is that they are now
 * prevented by a bound at both ends rather than by not offering the input. The
 * difference from the original design is that a custom date can be REFUSED —
 * see readExpiry: a preset that is out of range resolves silently to "no
 * expiry" because only a hand-made request could produce one, whereas a person
 * typed the custom date and discarding it quietly would show a form that
 * looked like it worked.
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
  { value: "1", label: "1 day", days: 1 },
  { value: "3", label: "3 days", days: 3 },
  { value: "7", label: "7 days", days: 7 },
  { value: "14", label: "2 weeks", days: 14 },
  { value: "30", label: "30 days", days: 30 },
  { value: "60", label: "60 days", days: 60 },
] as const;

/** YYYY-MM-DD, which is what <input type="date"> wants for min/max/value. */
function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatExpiry(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function ExpiryField({ current }: { current: string | null }) {
  // "keep" only exists while editing a posting that already has an expiry —
  // remapping a stored date onto the nearest preset would silently move it.
  const [choice, setChoice] = useState(current ? "keep" : "");
  const [customDate, setCustomDate] = useState("");
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
        <option value="custom">Pick a date…</option>
      </select>

      {choice === "custom" && (
        <>
          <label htmlFor="expiresOn" className="sr-only">
            Closing date
          </label>
          <input
            id="expiresOn"
            name="expiresOn"
            type="date"
            required
            /*
             * Tomorrow at the earliest, and at most MAX_EXPIRY_DAYS out. This
             * keeps a bad date from being *selectable*; it does not keep one
             * from being *posted*, which is why readExpiry checks both bounds
             * again against its own clock.
             */
            min={isoDate(1)}
            max={isoDate(MAX_EXPIRY_DAYS)}
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
          />
        </>
      )}
      <p className="text-[12.5px] text-ink-soft">
        {preset
          ? `Closes ${formatExpiry(preset.days)}.`
          : choice === "custom"
            ? customDate
              ? `Closes ${new Date(`${customDate}T12:00:00Z`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}, at the end of that day.`
              : `Pick any date up to ${MAX_EXPIRY_DAYS} days from now.`
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
  /** All optional, and independent of one another in this form's own
   * validation — see readSalaryForm in actions.ts for what combination is
   * actually required before anything is saved. */
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryUnit: string | null;
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
            <TextField
              label="Minimum salary"
              name="salaryMin"
              type="number"
              min={0}
              defaultValue={initial?.salaryMin ?? undefined}
              placeholder="Optional"
            />
            <TextField
              label="Maximum salary"
              name="salaryMax"
              type="number"
              min={0}
              defaultValue={initial?.salaryMax ?? undefined}
              placeholder="Optional"
            />
            <TextField
              label="Salary currency"
              name="salaryCurrency"
              defaultValue={initial?.salaryCurrency ?? undefined}
              placeholder="e.g. NGN, USD"
            />
            <ChoiceField
              label="Salary period"
              name="salaryUnit"
              options={SALARY_UNITS}
              defaultValue={initial?.salaryUnit}
            />
          </div>
          {(initial?.salaryMin || initial?.salaryMax) && (
            <p className="-mt-3 font-body text-[12.5px] text-ink-soft">
              Salary is shown to seekers and included in the job&rsquo;s search listing data. Add a
              currency if you set an amount, or leave both blank to keep the salary private.
            </p>
          )}

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
