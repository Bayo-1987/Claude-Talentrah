"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { MAX_EXPIRY_DAYS } from "@/lib/employer/expiry-input";
import { BorderedCard, Button, FilterChip, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";
import { extractStructuredJd, SKILL_VOCABULARY } from "@/lib/jobs/extract-jd";
import { ScreeningQuestionsEditor } from "./screening-questions-editor";
import type { ScreeningQuestionInput } from "@/lib/employer/screening-questions";
import type { EmployerActionState } from "@/lib/employer/actions";
import { RichMarkdownEditor, type RichMarkdownEditorHandle } from "./rich-markdown-editor";
import { AssessmentEditor } from "./assessment-editor";
import type { JobPostingAssessmentInput } from "@/lib/employer/job-posting-assessment";
import { draftJobWithFarahAction } from "@/lib/employer/draft-job-action";

/**
 * A select whose option labels differ from their stored values.
 *
 * The shared SelectField renders each option's raw value as its label, which
 * is right for the enums it was built for and wrong for these: the DB stores
 * `full_time`, and "Full_time" is not a thing to show an employer. Kept local
 * rather than widening the shared primitive for one caller.
 */
/**
 * `value`/`onChange` are optional — omitting both keeps this exactly the
 * plain `defaultValue`-only uncontrolled select every existing caller here
 * already uses. The one caller that needs to read/set this field
 * programmatically (send-368's "Draft with Farah" button, which fills
 * `employmentType` and `seniority` from a generated suggestion) passes them;
 * nothing else in this file needs to change.
 */
function ChoiceField({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
  placeholder = "Not specified",
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  value?: string;
  onChange?: (next: string) => void;
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
        {...(onChange
          ? { value: value ?? "", onChange: (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) }
          : { defaultValue: defaultValue ?? "" })}
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

/**
 * Autocomplete-only skill picker, feeding `structured_jd.skills` (the exact
 * denominator `computeMatchScore` divides by — see docs/stage8-match-
 * accuracy.md). An employer-posted job used to get NO structured skills at
 * all, which tripped `computeMatchScore`'s own "nothing to compare against"
 * branch and scored every candidate a flat 50%, Excellent-eligible included.
 *
 * ── WHY THIS IS AUTOCOMPLETE-ONLY, NOT A FREE-TEXT TAG INPUT ───────────────
 *
 * A custom tag an employer invents ("rockstar energy", "10x developer") would
 * sit in `structured_jd.skills` looking exactly like a real requirement, but
 * no resume's `skills` array will ever echo it back — this is precisely the
 * `NON_SCREENABLE_SKILLS` failure mode this file's own header (extract-jd.ts)
 * already warns about, self-inflicted at the source instead of discovered
 * after the fact by document-frequency measurement. Rather than build a
 * second, separately-stored "extra tags" bucket that never feeds scoring
 * (real but unused complexity) or let free text quietly join the screenable
 * set (reintroducing the exact bug Stage 8 has been closing), suggestions are
 * restricted to `SKILL_VOCABULARY` and nothing else can be added. The
 * options this form's own vocabulary can't yet name are a real gap (see
 * `docs/stage8-match-accuracy.md`'s step 1b), but it is a vocabulary-coverage
 * problem to fix in one place, not a per-posting escape hatch to reopen here.
 *
 * ── WHY IT PRE-POPULATES FROM THE DESCRIPTION ──────────────────────────────
 *
 * A field that starts empty and is merely optional to fill in gets skipped —
 * that was this bug's entire mechanism. `extractStructuredJd` (the SAME
 * function, not a reimplementation, that the aggregation pipeline runs
 * against every ingested posting) runs once against whatever the employer
 * has already typed into the description, either at mount (editing a
 * posting, or a URL import that remounts this form with fresh `initial`
 * values — see NewJobForm's own `formKey` note) or on the description
 * field's blur for a hand-typed blank-form post. It never overwrites a
 * choice the employer already made — see the blur handler below.
 */
function SkillsAutocomplete({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = normalizedQuery
    ? SKILL_VOCABULARY.filter(
        (skill) => skill.includes(normalizedQuery) && !skills.includes(skill),
      ).slice(0, 8)
    : [];

  function addSkill(skill: string) {
    if (!skills.includes(skill)) onChange([...skills, skill]);
    setQuery("");
  }

  function removeSkill(skill: string) {
    onChange(skills.filter((s) => s !== skill));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="skills-autocomplete" className="font-body text-[13px] font-semibold text-ink-soft">
        Skills seekers are matched against
      </label>
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <FilterChip key={skill} label={skill} onRemove={() => removeSkill(skill)} />
          ))}
        </div>
      )}
      <div className="relative">
        <input
          id="skills-autocomplete"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits the top suggestion — never the raw typed text,
            // which is how "autocomplete-only" stays true even from the
            // keyboard.
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions[0]) addSkill(suggestions[0]);
            }
          }}
          placeholder="Start typing a skill — e.g. Excel, SQL, procurement…"
          className="min-h-11 w-full border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full border-[1.5px] border-ink bg-card">
            {suggestions.map((skill) => (
              <li key={skill}>
                <button
                  type="button"
                  onClick={() => addSkill(skill)}
                  className="block min-h-10 w-full px-3.5 py-2 text-left font-body text-[14px] text-ink hover:bg-rust-soft"
                >
                  {skill}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="font-body text-[12.5px] text-ink-soft">
        {skills.length > 0
          ? "Pre-filled from your description where we recognised a skill — add or remove to match what the role actually needs."
          : "Add at least one skill so seekers are matched against real requirements, not scored a flat, meaningless number."}
      </p>
      {/* Multi-value the plain FormData way: one hidden input per selection,
       * read back with form.getAll("skills") — see readJobForm in actions.ts. */}
      {skills.map((skill) => (
        <input key={skill} type="hidden" name="skills" value={skill} />
      ))}
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
  /** Canonical `SKILL_VOCABULARY` entries only — see SkillsAutocomplete's own
   * header for why free text never joins this list. Feeds
   * `structured_jd.skills`, the denominator `computeMatchScore` divides by. */
  skills: string[];
  /** send-327 — empty for a brand-new posting or one that never had any. */
  screeningQuestions?: ScreeningQuestionInput[];
  /** send-346 v2 — undefined/null for a posting with no assessment attached. */
  assessment?: JobPostingAssessmentInput | null;
}

export function JobPostingForm({
  action,
  initial,
  submitLabel,
  pendingLabel,
  /** Shown above the form when the org can't publish publicly yet. */
  unverifiedNotice,
  /** send-449 — present only on the Edit page; see AssessmentEditor's own header. */
  assessmentEditContext,
  /**
   * send-447 — Create only; Edit never passes this. See new-job-form.tsx's
   * own comment for why Edit doesn't need a second button: an already-`open`
   * posting has nothing left to draft into, and publishing an existing draft
   * is a Jobs Posted row action (posted-job-row.tsx's Publish button), not a
   * second submit here.
   *
   * Both buttons submit through the SAME `action`/`useActionState` pair —
   * there is no second action function, just a second `<button
   * name="intent">` inside the one `<form>`. Native HTML form semantics
   * already put whichever button was actually clicked into the submitted
   * FormData; postJobAction reads `form.get("intent")` to decide `status`.
   * This is what keeps ONE `pending` boolean honest for both buttons —
   * `useActionState` only ever tracks one action, and there is only one
   * here.
   */
  secondarySubmitLabel,
  secondaryPendingLabel,
}: {
  action: (state: EmployerActionState, form: FormData) => Promise<EmployerActionState>;
  initial?: JobFormValues;
  submitLabel: string;
  pendingLabel: string;
  unverifiedNotice?: string;
  assessmentEditContext?: { jobId: string; userId: string };
  secondarySubmitLabel?: string;
  secondaryPendingLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(action, null);
  const error = state && "error" in state ? state.error : null;
  // send-457 — on a page this long (title down through description,
  // screening questions, assessment), a rejected save renders this banner
  // above the whole form while the person is still scrolled down at the
  // button they just clicked. The page never navigates away either, so
  // without this the natural read is "nothing happened" rather than "here's
  // what's wrong" — which is exactly how the salary validation bug above
  // went unnoticed. Scrolled into view on every NEW error, not on mount.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  /*
   * WHICH button is pending, not just whether one is. `pending` alone can't
   * tell "Publish job" from "Save as draft" — both submit through the same
   * `formAction`/`useActionState` pair (see this component's own prop
   * comment on `secondarySubmitLabel`), so this is set from each button's
   * own click, read only while `pending` is true, and irrelevant (never
   * read) on the single-button Edit form.
   */
  const [pendingIntent, setPendingIntent] = useState<"primary" | "secondary" | null>(null);

  // send-368 — "Draft with Farah" needs to READ title (to enable/disable the
  // button and send it to the action) and WRITE location/workType/
  // employmentType/seniority/yearsExperienceMin (the fill-rules below only
  // touch a field that's still empty) — lifting these five was the smallest
  // diff that made the button possible. (salaryMin/salaryMax are lifted
  // separately, for a different reason — see their own comment below.)
  const [title, setTitle] = useState(initial?.title ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [workType, setWorkType] = useState(initial?.workType ?? "");
  const [employmentType, setEmploymentType] = useState(initial?.employmentType ?? "");
  const [seniority, setSeniority] = useState(initial?.seniority ?? "");
  const [yearsExperienceMin, setYearsExperienceMin] = useState(
    initial?.yearsExperienceMin != null ? String(initial.yearsExperienceMin) : "",
  );
  // send-457 — lifted from defaultValue so the "add a currency" hint below
  // can read the LIVE value. Gating it on `initial?.salaryMin` instead meant
  // the one person who most needed the reminder — someone typing a salary
  // amount for the first time, on a brand-new posting or one that never had
  // one — never saw it, because `initial` is only ever what was loaded from
  // the database at page load.
  const [salaryMin, setSalaryMin] = useState(initial?.salaryMin != null ? String(initial.salaryMin) : "");
  const [salaryMax, setSalaryMax] = useState(initial?.salaryMax != null ? String(initial.salaryMax) : "");
  const descriptionRef = useRef<RichMarkdownEditorHandle>(null);
  const [descriptionText, setDescriptionText] = useState(initial?.description ?? "");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftErrorKind, setDraftErrorKind] = useState<"insufficient_balance" | "generation_error" | null>(null);

  // Editing an already-tagged posting, or a URL import that already found
  // skills (JobImportPanel doesn't run extraction itself, but a future
  // import source could), wins. Otherwise, seed from whatever description
  // text arrived with this mount — the same extractor the aggregation
  // pipeline runs, not a reimplementation.
  const [skills, setSkills] = useState<string[]>(() => {
    if (initial?.skills && initial.skills.length > 0) return initial.skills;
    if (initial?.description) return extractStructuredJd(initial.description).skills;
    return [];
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Covers the blank-form case the mount-time seed above can't: an employer
   * who opens a brand-new posting, types a description by hand, and never
   * touches the skills field. Never overwrites a real choice — including a
   * deliberate "none of these" — which is why the functional update below
   * only applies while `skills` is still at its untouched empty starting
   * point, checked at the moment it actually commits rather than against a
   * value captured when the timer was scheduled.
   *
   * Debounced off every editor update rather than triggered on blur (the
   * original shape): blur fires as a side effect of whatever the employer
   * clicks next, which is "Publish job" for anyone who goes straight from
   * typing to submitting. That makes the population's own re-render — new
   * chips appear directly above the button — race the click already in
   * flight: the button's on-screen position shifts out from under a pointer
   * that already committed to the pre-shift coordinates, so the click lands
   * on nothing and the submission never happens. Reacting to typing instead
   * means the chips settle while the employer is still writing, long before
   * any click near the button is possible.
   *
   * `text` arrives already serialized back to the same markdown-subset
   * string `extractStructuredJd` has always read (send-367's rich editor
   * only changes the AUTHORING surface — see rich-markdown-editor.tsx's own
   * header for why the stored/extracted format is untouched).
   */
  function handleDescriptionChange(text: string) {
    setDescriptionText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!text) return;
      const suggested = extractStructuredJd(text).skills;
      if (suggested.length === 0) return;
      setSkills((current) => (current.length > 0 ? current : suggested));
    }, 400);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /**
   * send-368 — "Draft with Farah". Modeled directly on resume-editor.tsx's
   * RewriteButtons/handleRewrite shape: a plain awaited call (this employer
   * is actively watching the result, unlike farah-review.ts's fire-and-
   * forget `after()` pattern), one `drafting` boolean, one `draftError`
   * string.
   *
   * Money and generation happen entirely server-side
   * (draft-job-action.ts) — this function only decides whether to ask for
   * confirmation, and which currently-empty fields to fill afterward.
   */
  async function handleDraftWithFarah() {
    if (!title.trim()) return;
    if (
      descriptionText.trim().length > 0 &&
      !window.confirm("This will replace the current job description with Farah's draft. Continue?")
    ) {
      return;
    }
    setDrafting(true);
    setDraftError(null);
    setDraftErrorKind(null);
    try {
      const result = await draftJobWithFarahAction({ title, location });
      if (!result.ok) {
        setDraftError(result.error);
        setDraftErrorKind(result.kind);
        return;
      }
      // Description and skills are tied 1:1 to this draft, so both are
      // always overwritten on confirm — the confirm dialog above is the
      // "are you sure" for this pair, not a per-field one. Every other
      // suggested field is filled ONLY where the employer hasn't already
      // made a choice: the moment this silently clobbers a deliberate
      // choice, it stops being a helpful draft and starts being data loss.
      descriptionRef.current?.setMarkdown(result.description);
      setDescriptionText(result.description);
      setSkills(result.skills);
      if (!seniority && result.seniority) setSeniority(result.seniority);
      if (!workType && result.workType) setWorkType(result.workType);
      if (!employmentType && result.employmentType) setEmploymentType(result.employmentType);
      if (!yearsExperienceMin && result.yearsExperienceMin != null) {
        setYearsExperienceMin(String(result.yearsExperienceMin));
      }
    } catch {
      setDraftError("Farah couldn't draft that just now — try again.");
      setDraftErrorKind("generation_error");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {unverifiedNotice && (
        <p className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px] text-ink">
          {unverifiedNotice}
        </p>
      )}
      {error && (
        <p
          ref={errorRef}
          className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust"
        >
          {error}
        </p>
      )}

      <BorderedCard className="p-6">
        <form
          action={formAction}
          className="flex flex-col gap-5"
          /*
           * send-445 — a plain single-line <input> inside a <form> with one
           * submit button triggers the browser's native implicit
           * submission on Enter; this is standard HTML behaviour, not a
           * bug in any one field. Title, location, salary, years of
           * experience and every screening-question field are all plain
           * inputs with no keydown handling of their own, so pressing
           * Enter out of habit while finishing a line (typing a screening
           * question, say) submits the whole job with whatever is in
           * state at that instant — confirmed against real production
           * evidence: a job saved with exactly 2 of 5 typed screening
           * questions, one clean POST, no error, no truncation anywhere
           * in the save path.
           *
           * Excluded on purpose:
           *  - `isContentEditable` / TEXTAREA: the rich description and
           *    assessment-instructions editors (rich-markdown-editor.tsx,
           *    a TipTap/ProseMirror contenteditable surface) need Enter
           *    for real newlines. A contenteditable div is not a
           *    form-associated control in the first place, so it was
           *    never part of the browser's implicit-submission hazard
           *    this guard exists for — excluded here anyway so this
           *    handler can't fight ProseMirror's own Enter handling for
           *    that surface, not because it would otherwise submit.
           *  - BUTTON: pressing Enter on the focused "Save"/"Publish"
           *    button must still submit — that is the one place Enter is
           *    supposed to do exactly this.
           *  - SkillsAutocomplete's own input already calls
           *    `preventDefault()` in its own onKeyDown to commit the top
           *    suggestion instead of submitting. This handler still runs
           *    afterward (React's synthetic events keep bubbling after a
           *    child calls preventDefault() — only stopPropagation() would
           *    stop that), and calls preventDefault() again, which is a
           *    harmless no-op alongside logic that already ran.
           */
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const target = e.target as HTMLElement;
            if (target.tagName === "TEXTAREA" || target.tagName === "BUTTON" || target.isContentEditable) {
              return;
            }
            e.preventDefault();
          }}
        >
          <div className="grid grid-cols-1 gap-5 min-[640px]:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <TextField
                label="Job title"
                name="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Backend Engineer (Node.js)"
              />
              {/*
                send-368 — "Draft with Farah": a paid, opt-in, single-click AI
                draft of the job description plus a handful of suggested
                fields (src/lib/employer/draft-job.ts). Disabled until a title
                exists, since the LLM prompt is built from it — never
                auto-runs, and every field on this form stays directly
                editable with or without ever touching this button (a
                zero-ad-wallet-balance org just sees "not enough balance" on
                click and posting is otherwise unaffected).
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!title.trim() || drafting}
                  onClick={handleDraftWithFarah}
                >
                  {drafting ? "Farah is scoping this job…" : "✦ Let Farah scope this job"}
                </Button>
              </div>
              {draftError && (
                <p className="font-body text-[12.5px] text-rust">
                  {draftError}{" "}
                  {draftErrorKind === "insufficient_balance" && (
                    <Link
                      href="/employer/campaigns"
                      className="font-semibold underline underline-offset-2 hover:text-rust"
                    >
                      Top up
                    </Link>
                  )}
                </p>
              )}
            </div>
            <TextField
              label="Location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Lagos, Nigeria"
            />
            <ChoiceField
              label="Work type"
              name="workType"
              options={WORK_TYPES}
              value={workType ?? ""}
              onChange={setWorkType}
            />
            <ChoiceField
              label="Employment type"
              name="employmentType"
              options={EMPLOYMENT_TYPES}
              value={employmentType ?? ""}
              onChange={setEmploymentType}
            />
            <ChoiceField
              label="Seniority"
              name="seniority"
              options={SENIORITIES}
              value={seniority ?? ""}
              onChange={setSeniority}
            />
            <ExpiryField current={initial?.expiresAt ?? null} />
            <TextField
              label="Minimum years of experience"
              name="yearsExperienceMin"
              type="number"
              min={0}
              max={40}
              value={yearsExperienceMin}
              onChange={(e) => setYearsExperienceMin(e.target.value)}
              placeholder="Optional"
            />
            <TextField
              label="Minimum salary"
              name="salaryMin"
              type="number"
              min={0}
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
              placeholder="Optional"
            />
            <TextField
              label="Maximum salary"
              name="salaryMax"
              type="number"
              min={0}
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
              placeholder="Optional"
            />
            <TextField
              label="Salary currency"
              name="salaryCurrency"
              defaultValue={initial?.salaryCurrency ?? undefined}
              placeholder="e.g. NGN, USD"
              // send-457 — the browser's own validation catches the missing-
              // currency case before a round trip: required only once an
              // amount is actually present, so leaving both blank (the
              // "no salary" case readSalaryForm itself treats as valid)
              // still submits fine.
              required={Boolean(salaryMin || salaryMax)}
            />
            <ChoiceField
              label="Salary period"
              name="salaryUnit"
              options={SALARY_UNITS}
              defaultValue={initial?.salaryUnit}
            />
          </div>
          {(salaryMin || salaryMax) && (
            <p className="-mt-3 font-body text-[12.5px] text-ink-soft">
              Salary is shown to seekers and included in the job&rsquo;s search listing data. Add a
              currency if you set an amount, or leave both blank to keep the salary private.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {/*
              send-367 — a real WYSIWYG editor replaces the old textarea +
              toolbar + separate Preview toggle: what the employer sees while
              typing IS the formatted result now, so a second "Preview" mode
              would just be showing the same thing twice. See
              rich-markdown-editor.tsx's own header for the one rule that
              keeps this safe (the stored string's format never changes).
            */}
            <RichMarkdownEditor
              ref={descriptionRef}
              id="description"
              name="description"
              label="Job description"
              required
              defaultValue={initial?.description}
              placeholder="Responsibilities, requirements, what the team is like, how to stand out."
              onTextChange={handleDescriptionChange}
            />

            <p className="font-body text-[12.5px] text-ink-soft">
              This is what seekers are matched against — the more concrete the requirements, the
              better the match scores. Use bold, bullets, or numbered steps to make responsibilities
              and requirements easy to scan.
            </p>
          </div>

          <SkillsAutocomplete skills={skills} onChange={setSkills} />

          <ScreeningQuestionsEditor initial={initial?.screeningQuestions} />

          <AssessmentEditor
            initial={initial?.assessment}
            editContext={assessmentEditContext}
          />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              name={secondarySubmitLabel ? "intent" : undefined}
              value={secondarySubmitLabel ? "publish" : undefined}
              disabled={pending}
              onClick={() => setPendingIntent("primary")}
            >
              {pending && pendingIntent === "primary" ? pendingLabel : submitLabel}
            </Button>
            {secondarySubmitLabel && (
              <Button
                type="submit"
                variant="secondary"
                name="intent"
                value="draft"
                disabled={pending}
                onClick={() => setPendingIntent("secondary")}
              >
                {pending && pendingIntent === "secondary" ? secondaryPendingLabel : secondarySubmitLabel}
              </Button>
            )}
          </div>
        </form>
      </BorderedCard>
    </div>
  );
}
