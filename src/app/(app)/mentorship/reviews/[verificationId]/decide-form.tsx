"use client";

import { useActionState } from "react";
import { decideVerificationReviewAction } from "@/lib/talent-directory/reviewer-actions";
import { Button } from "@/components/ui";
import { MinimalRichEditor } from "@/components/rich-text/minimal-rich-editor";

const initialState: { status: "idle" | "success" | "error"; message: string } = {
  status: "idle",
  message: "",
};

export function DecideForm({ verificationId, candidateId }: { verificationId: string; candidateId: string }) {
  const [state, formAction, pending] = useActionState(decideVerificationReviewAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="verificationId" value={verificationId} />
      <input type="hidden" name="candidateId" value={candidateId} />

      {/*
       * send-372 — the candidate's own /talent-directory/verify page already
       * has a real read site for this text (verify/page.tsx's history list,
       * via getVerificationHistory's `feedback` column) — this ticket only
       * upgrades the editor/renderer, not the workflow. Reduced grammar
       * (bold/italic only, no autolink) matches every other sibling
       * DecisionForm-style note (campaign/mentor rejection) — this is
       * reviewer feedback, not long-form prose.
       */}
      <MinimalRichEditor
        id="notes"
        name="notes"
        label="Notes for the candidate"
        required
        minHeightClassName="min-h-24"
      />

      <div className="flex gap-3">
        <Button type="submit" name="decision" value="verified" variant="primary" disabled={pending}>
          Mark verified
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="secondary" disabled={pending}>
          Not verified
        </Button>
      </div>

      {state.message && (
        <p className={`text-[13px] ${state.status === "error" ? "text-rust" : "text-green"}`}>{state.message}</p>
      )}
    </form>
  );
}
