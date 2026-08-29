"use client";

import { useActionState } from "react";
import { createScholarshipAction, loadQueueAction } from "@/lib/scholarships/admin-actions";
import { initialAdminScholarshipState } from "@/lib/scholarships/admin-state";
import { DEGREE_LEVEL_VALUES, FUNDING_TYPE_VALUES } from "@/lib/scholarships/schemas";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL } from "@/lib/scholarships/types";
import { TextField, SelectField, Button, EyebrowLabel, BorderedCard } from "@/components/ui";

const FUNDING_OPTIONS = FUNDING_TYPE_VALUES.map((value) => ({
  value,
  label: FUNDING_TYPE_LABEL[value],
}));

/** Shared field styling — the form has enough inputs that repeating it drifts. */
const AREA_CLASS =
  "border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none placeholder:font-display placeholder:text-[14px] placeholder:italic placeholder:text-ink-soft focus:border-rust";

export function AdminScholarshipForm() {
  const [state, formAction, pending] = useActionState(
    createScholarshipAction,
    initialAdminScholarshipState,
  );
  const [queueState, queueAction, queuePending] = useActionState(
    loadQueueAction,
    initialAdminScholarshipState,
  );

  // Whichever half last ran is the one holding a fresh queue and a real
  // freshest queue. Creating re-reads the queue, so preferring the
  // create state when it has one keeps the new row visible immediately.
  const active = state.pending !== null ? state : queueState;
  const queue = active.pending;

  return (
    <div className="flex flex-col gap-8">
      {/*
        The password card that used to sit here is gone. It asked the operator
        to type the shared admin secret before the form would appear — the only
        identity check available when this page shipped. The page now lives
        inside the (protected) route group behind a real admin session, so the
        field was a second credential protecting something already protected.

        `loadQueueAction` survives as a plain refresh: "show me what is
        pending" was always the useful half of that form.
      */}
      <form action={queueAction}>
        <Button type="submit" variant="secondary" size="sm" disabled={queuePending}>
          {queuePending ? "Loading…" : "Show pending queue"}
        </Button>
      </form>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <EyebrowLabel>Awaiting review</EyebrowLabel>
          {queue === null ? (
            <p className="font-display text-[14px] italic text-ink-soft">
              Not loaded yet — use “Show pending queue”.
            </p>
          ) : queue.length === 0 ? (
            <p className="font-display text-[14px] italic text-ink-soft">
              Nothing pending — every listing has been reviewed.
            </p>
          ) : (
            <ul className="flex flex-col border-t border-line">
              {queue.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-3"
                >
                  <span className="font-body text-[15px] font-semibold text-ink">
                    {row.provider}
                  </span>
                  <span className="font-body text-[15px] text-ink-soft">{row.program_name}</span>
                  <span className="font-body text-[13px] text-ink-soft">
                    {row.application_deadline ?? "no deadline recorded"}
                  </span>
                  <a
                    href={row.official_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-10 min-w-10 items-center font-body text-[13px] text-rust underline underline-offset-2"
                  >
                    Source
                  </a>
                </li>
              ))}
            </ul>
          )}
          {/*
            Read-only on purpose. Approving is /api/admin/moderate-scholarship,
            and putting a Publish button here would mean a second path to the
            one action this whole gate exists to control.
          */}
          <p className="font-display text-[13px] italic text-ink-soft">
            Read-only. Approving or rejecting is still a call to
            /api/admin/moderate-scholarship.
          </p>
        </div>
      </section>

      <BorderedCard className="max-w-[720px] p-6">
        <form action={formAction} className="flex flex-col gap-5">
          <EyebrowLabel>New listing</EyebrowLabel>

          {state.status === "success" &&
            (state.returnedToReview ? (
              /*
                Deliberately louder than the ordinary success note. This path
                means a listing that was live a moment ago is now hidden — the
                operator edited a published listing rather than adding a new
                one, and that is not what they think they just did.
              */
              <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
                That matched a listing already published, and the content
                differs — so it&apos;s been taken off the catalog and put back in
                the queue above. Re-approve it to make it visible again.
              </p>
            ) : (
              <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[13.5px] text-ink">
                Saved as pending. It won&apos;t appear in the public catalog until
                it&apos;s approved.
              </p>
            ))}
          {state.status === "error" && (
            <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
              {state.error}
            </p>
          )}

          <TextField
            label="Provider"
            name="provider"
            placeholder="Petroleum Technology Development Fund (PTDF)"
            required
            error={state.fieldErrors?.provider?.[0]}
          />
          <TextField
            label="Programme name"
            name="programName"
            placeholder="Overseas Scholarship Scheme"
            required
            error={state.fieldErrors?.programName?.[0]}
          />
          <TextField
            label="Host institution (optional)"
            name="hostInstitution"
            error={state.fieldErrors?.hostInstitution?.[0]}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="font-body text-[13px] font-semibold text-ink-soft">
              Degree levels
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {DEGREE_LEVEL_VALUES.map((value) => (
                <label
                  key={value}
                  className="inline-flex min-h-10 items-center gap-2 font-body text-[14px] text-ink"
                >
                  <input
                    type="checkbox"
                    name="degreeLevels"
                    value={value}
                    className="h-4 w-4 accent-[oklch(52%_0.14_40)]"
                  />
                  {DEGREE_LEVEL_LABEL[value]}
                </label>
              ))}
            </div>
            {state.fieldErrors?.degreeLevels?.[0] && (
              <p className="text-[12.5px] text-rust">{state.fieldErrors.degreeLevels[0]}</p>
            )}
          </fieldset>

          <SelectField
            label="Funding"
            name="fundingType"
            options={FUNDING_OPTIONS}
            placeholder="Fully or partially funded…"
            required
            error={state.fieldErrors?.fundingType?.[0]}
          />

          <TextField
            label="What it covers (comma-separated)"
            name="fundingCovers"
            placeholder="Tuition, Stipend, Travel"
            error={state.fieldErrors?.fundingCovers?.[0]}
          />
          <TextField
            label="Field tags (comma-separated)"
            name="fieldTags"
            placeholder="Engineering, Geosciences"
            error={state.fieldErrors?.fieldTags?.[0]}
          />
          <TextField
            label="Eligible nationalities (comma-separated)"
            name="eligibilityNationalities"
            placeholder="Nigeria"
            error={state.fieldErrors?.eligibilityNationalities?.[0]}
          />
          <TextField
            label="Prior degree required (optional)"
            name="eligibilityPriorDegree"
            error={state.fieldErrors?.eligibilityPriorDegree?.[0]}
          />
          <TextField
            label="Age requirement (optional)"
            name="eligibilityAge"
            error={state.fieldErrors?.eligibilityAge?.[0]}
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="eligibilityOther"
              className="font-body text-[13px] font-semibold text-ink-soft"
            >
              Other eligibility notes (optional)
            </label>
            <textarea id="eligibilityOther" name="eligibilityOther" rows={3} className={AREA_CLASS} />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="min-w-[200px] flex-1">
              <TextField
                label="Deadline (YYYY-MM-DD, optional)"
                name="applicationDeadline"
                placeholder="2026-03-31"
                error={state.fieldErrors?.applicationDeadline?.[0]}
              />
            </div>
            <div className="min-w-[140px] flex-1">
              <TextField
                label="Cycle year (optional)"
                name="cycleYear"
                placeholder="2026"
                error={state.fieldErrors?.cycleYear?.[0]}
              />
            </div>
          </div>

          <TextField
            label="Deadline note — shown when there's no single date"
            name="deadlineNote"
            placeholder="Varies by partner institution"
            error={state.fieldErrors?.deadlineNote?.[0]}
          />

          <TextField
            label="Official source URL"
            name="officialUrl"
            type="url"
            placeholder="https://provider.example/scholarship"
            required
            error={state.fieldErrors?.officialUrl?.[0]}
          />
          <TextField
            label="Source name"
            name="sourceName"
            placeholder="Manual entry"
            error={state.fieldErrors?.sourceName?.[0]}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reviewNote" className="font-body text-[13px] font-semibold text-ink-soft">
              Reviewer note (optional) — what you checked
            </label>
            <textarea id="reviewNote" name="reviewNote" rows={3} className={AREA_CLASS} />
          </div>

          <Button type="submit" disabled={pending} className="mt-1 self-start">
            {pending ? "Saving…" : "Save as pending"}
          </Button>
        </form>
      </BorderedCard>
    </div>
  );
}
