"use client";

import { useRef } from "react";
import { updateStageAction } from "@/lib/applications/tracker-actions";
import { cn } from "@/lib/cn";
import { TRACKER_STAGES } from "@/lib/tracker/stages";

export function StageSelect({
  applicationId,
  stage,
  jobTitle,
  companyName,
}: {
  applicationId: string;
  stage: string;
  jobTitle: string;
  companyName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <form
      ref={formRef}
      action={updateStageAction.bind(null, applicationId)}
      className="inline-flex"
    >
      {/*
        The stage this control was rendered with. updateStageAction uses it as
        an optimistic lock so a double-click or a second tab can't silently
        clobber the other's change.
      */}
      <input type="hidden" name="expectedStage" value={stage} />
      <select
        ref={selectRef}
        name="stage"
        /*
          Without a name every card's control is announced as just "combobox, Applied", with nothing saying which
          job it changes (X2). Title and company together, because two postings can share a title.
        */
        aria-label={`Stage for ${jobTitle} at ${companyName}`}
        defaultValue={stage}
        onChange={(e) => {
          // Marking "Hired" is the highest-trust, highest-goodwill moment in
          // the whole product (build-prompt §2.5) — it needs to be a
          // deliberate action, not an accidental dropdown slip.
          if (
            e.target.value === "hired" &&
            !window.confirm(`Congrats! Mark "${jobTitle}" as Hired?`)
          ) {
            e.target.value = stage;
            return;
          }
          formRef.current?.requestSubmit();
        }}
        className={cn(
          "min-h-10 border-[1.5px] border-ink bg-card px-2.5 py-1.5 font-body text-[13px] font-semibold text-ink outline-none focus:border-rust",
          stage === "hired" && "border-green text-green",
        )}
      >
        {TRACKER_STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}
