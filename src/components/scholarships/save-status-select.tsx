"use client";

import { useRef } from "react";
import { updateSaveStatusAction } from "@/lib/scholarships/actions";
import { SAVE_STATUS_LABEL, type SaveStatus } from "@/lib/scholarships/types";

const ORDER: SaveStatus[] = ["saved", "applying", "submitted", "outcome"];

/**
 * Mirrors the Job Tracker's StageSelect rather than inventing a second
 * tracking interaction — same submit-on-change select, minus the Hired
 * confirm (there's no equivalent high-stakes moment in this flow).
 */
export function SaveStatusSelect({ saveId, status }: { saveId: string; status: SaveStatus }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={updateSaveStatusAction.bind(null, saveId)} className="inline-flex">
      <select
        name="status"
        defaultValue={status}
        onChange={() => formRef.current?.requestSubmit()}
        className="min-h-10 border-[1.5px] border-ink bg-card px-2.5 py-1.5 font-body text-[13px] font-semibold text-ink outline-none focus:border-rust"
      >
        {ORDER.map((value) => (
          <option key={value} value={value}>
            {SAVE_STATUS_LABEL[value]}
          </option>
        ))}
      </select>
    </form>
  );
}
