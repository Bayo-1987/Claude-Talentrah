"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createScholarshipAction, loadQueueAction } from "@/lib/scholarships/admin-actions";
import { initialAdminScholarshipState } from "@/lib/scholarships/admin-state";
import { nextEditorGeneration } from "@/lib/scholarships/editor-generation";
import { inputList, inputValue, selectKey } from "@/lib/forms/keep-input";
import { DEGREE_LEVEL_LABEL, DEGREE_LEVEL_VALUES, FUNDING_TYPE_LABEL, FUNDING_TYPE_VALUES } from "@/lib/scholarships/types";
import { TextField, SelectField, Button, EyebrowLabel, BorderedCard } from "@/components/ui";
import { noteCounter } from "@/lib/scholarships/public-deadline-note";
import { MinimalRichEditor } from "@/components/rich-text/minimal-rich-editor";

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
  // Counted, not capped: truncating as they type would silently drop text; showing how far over they are lets them cut what they choose.
  const [noteLength, setNoteLength] = useState(0);
  /*
   * The "Other eligibility notes" editor is uncontrolled, so the form reset that clears every native field after a submit cannot clear it. It is remounted (by key) each time a
   * save SUCCEEDS and left alone when the save fails, so a field error never costs the operator their text. Adjusted during render from the action's state, not in an effect.
   */
  const [seenState, setSeenState] = useState(state);
  const [editorGeneration, setEditorGeneration] = useState(0);
  if (state !== seenState) {
    setSeenState(state);
    setEditorGeneration(nextEditorGeneration(seenState, state, editorGeneration));
    setNoteLength((state.values?.deadlineNote ?? "").trim().length); // the form was reset: the counter follows the field (the returned note after an error, 0 after a save)
  }

  // The banner is at the top of a long form and Save is at the bottom: bring the result into view whenever a save finishes.
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "idle") return;
    bannerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  const counter = noteCounter(noteLength);
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
            Read-only on purpose. Approving happens on /admin/scholarships, and
            putting a Publish button here too would mean a second path to the
            one action this whole gate exists to control.

            This used to name /api/admin/moderate-scholarship, which has been
            retired. It mattered that this line got fixed with the route: it is
            not a comment, it is the sentence an operator reads to find out
            where to go next, and pointing it at a 404 would have made the page
            a dead end.
          */}
          <p className="font-display text-[13px] italic text-ink-soft">
            Read-only here. Approving or rejecting is on{" "}
            <Link href="/admin/scholarships" className="underline">
              the review queue
            </Link>
            .
          </p>
        </div>
      </section>

      <BorderedCard className="max-w-[720px] p-6">
        <form action={formAction} className="flex flex-col gap-5">
          <EyebrowLabel>New listing</EyebrowLabel>

          <div ref={bannerRef} className="scroll-mt-24">
            {state.status !== "idle" && (
              <p
                role={state.status === "error" ? "alert" : "status"}
                className={
                  "border-[1.5px] px-3.5 py-2.5 text-[13.5px] " +
                  (state.status === "error" || state.returnedToReview
                    ? "border-rust bg-rust-soft text-rust"
                    : "border-ink bg-card text-ink")
                }
              >
                {state.status === "error"
                  ? state.error
                  : state.returnedToReview
                    ? /* Deliberately louder than the ordinary success note: a listing that was live a moment ago is now hidden, because the operator edited a published listing rather than adding a new one. */
                      "That matched a listing already published, and the content differs — so it's been taken off the catalog and put back in the queue above. Re-approve it to make it visible again."
                    : "Saved as pending. It won't appear in the public catalog until it's approved."}
              </p>
            )}
          </div>

          <TextField
            label="Provider"
            name="provider"
            defaultValue={inputValue(state.values, "provider")}
            placeholder="Petroleum Technology Development Fund (PTDF)"
            required
            error={state.fieldErrors?.provider?.[0]}
          />
          <TextField
            label="Programme name"
            name="programName"
            defaultValue={inputValue(state.values, "programName")}
            placeholder="Overseas Scholarship Scheme"
            required
            error={state.fieldErrors?.programName?.[0]}
          />
          <TextField
            label="Host institution (optional)"
            name="hostInstitution"
            defaultValue={inputValue(state.values, "hostInstitution")}
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
                    defaultChecked={inputList(state.values, "degreeLevels").includes(value)}
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
            key={selectKey(state.values, "fundingType")}
            label="Funding"
            name="fundingType"
            defaultValue={inputValue(state.values, "fundingType")}
            options={FUNDING_OPTIONS}
            placeholder="Fully or partially funded…"
            required
            error={state.fieldErrors?.fundingType?.[0]}
          />

          <TextField
            label="What it covers (comma-separated)"
            name="fundingCovers"
            defaultValue={inputValue(state.values, "fundingCovers")}
            placeholder="Tuition, Stipend, Travel"
            error={state.fieldErrors?.fundingCovers?.[0]}
          />
          <TextField
            label="Field tags (comma-separated)"
            name="fieldTags"
            defaultValue={inputValue(state.values, "fieldTags")}
            placeholder="Engineering, Geosciences"
            error={state.fieldErrors?.fieldTags?.[0]}
          />
          <TextField
            label="Eligible nationalities (comma-separated)"
            name="eligibilityNationalities"
            defaultValue={inputValue(state.values, "eligibilityNationalities")}
            placeholder="Nigeria"
            error={state.fieldErrors?.eligibilityNationalities?.[0]}
          />
          <TextField
            label="Prior degree required (optional)"
            name="eligibilityPriorDegree"
            defaultValue={inputValue(state.values, "eligibilityPriorDegree")}
            error={state.fieldErrors?.eligibilityPriorDegree?.[0]}
          />
          <TextField
            label="Age requirement (optional)"
            name="eligibilityAge"
            defaultValue={inputValue(state.values, "eligibilityAge")}
            error={state.fieldErrors?.eligibilityAge?.[0]}
          />

          {/*
           * send-377 — bold/italic + paragraph breaks only, matching real
           * production data (dense, citation-heavy quoted provider prose,
           * no lists/headings in the wild). This same column is also
           * written directly by the ingest pipeline (ingest.ts) as a plain
           * scraped string with no markdown syntax at all — the render side
           * (public scholarship page) and the Farah eligibility-check
           * grounding string (farah.ts, via stripInlineMarkdown) both
           * already handle a plain string with zero formatting exactly as
           * before, so a scraped value isn't a second case to special-case.
           */}
          <MinimalRichEditor
            key={editorGeneration}
            id="eligibilityOther"
            name="eligibilityOther"
            label="Other eligibility notes (optional)"
            defaultValue={inputValue(state.values, "eligibilityOther")}
            minHeightClassName="min-h-[76px]"
          />

          <div className="flex flex-wrap gap-4">
            <div className="min-w-[200px] flex-1">
              <TextField
                label="Deadline (YYYY-MM-DD, optional)"
                name="applicationDeadline"
                defaultValue={inputValue(state.values, "applicationDeadline")}
                placeholder="2026-03-31"
                error={state.fieldErrors?.applicationDeadline?.[0]}
              />
            </div>
            <div className="min-w-[140px] flex-1">
              <TextField
                label="Cycle year (optional)"
                name="cycleYear"
                defaultValue={inputValue(state.values, "cycleYear")}
                placeholder="2026"
                error={state.fieldErrors?.cycleYear?.[0]}
              />
            </div>
          </div>

          <TextField
            label="Deadline note — shown when there's no single date"
            name="deadlineNote"
            defaultValue={inputValue(state.values, "deadlineNote")}
            placeholder="Varies by partner institution"
            onChange={(e) => setNoteLength(e.target.value.trim().length)}
            error={state.fieldErrors?.deadlineNote?.[0]}
          />
          <p
            aria-live="polite"
            className={counter.over ? "-mt-3 text-[12.5px] font-semibold text-rust" : "-mt-3 text-[12.5px] text-ink-soft"}
          >
            {counter.text}
          </p>

          <TextField
            label="Official source URL"
            name="officialUrl"
            defaultValue={inputValue(state.values, "officialUrl")}
            type="url"
            placeholder="https://provider.example/scholarship"
            required
            error={state.fieldErrors?.officialUrl?.[0]}
          />
          <TextField
            label="Source name"
            name="sourceName"
            defaultValue={inputValue(state.values, "sourceName")}
            placeholder="Manual entry"
            error={state.fieldErrors?.sourceName?.[0]}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reviewNote" className="font-body text-[13px] font-semibold text-ink-soft">
              Reviewer note (optional) — what you checked
            </label>
            <textarea id="reviewNote" name="reviewNote" rows={3} defaultValue={inputValue(state.values, "reviewNote")} className={AREA_CLASS} />
          </div>

          <Button type="submit" disabled={pending} className="mt-1 self-start">
            {pending ? "Saving…" : "Save as pending"}
          </Button>
        </form>
      </BorderedCard>
    </div>
  );
}
