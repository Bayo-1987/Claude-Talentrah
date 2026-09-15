"use client";

import { useActionState } from "react";
import { decideVerificationReviewAction } from "@/lib/talent-directory/reviewer-actions";
import { Button } from "@/components/ui";

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="font-body text-[13px] font-semibold text-ink-soft">
          Notes for the candidate
        </label>
        <textarea
          id="notes"
          name="notes"
          required
          className="min-h-24 border-[1.5px] border-ink bg-card p-2.5 font-body text-[15px] text-ink"
        />
      </div>

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
