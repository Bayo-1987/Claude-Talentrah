"use client";

import { useRef } from "react";
import { updateStageAction } from "@/lib/applications/tracker-actions";
import { cn } from "@/lib/cn";

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];

export function StageSelect({
  applicationId,
  stage,
  jobTitle,
}: {
  applicationId: string;
  stage: string;
  jobTitle: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <form
      ref={formRef}
      action={updateStageAction.bind(null, applicationId)}
      className="inline-flex"
    >
      <select
        ref={selectRef}
        name="stage"
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
        {STAGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}
