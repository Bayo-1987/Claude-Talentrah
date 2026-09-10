"use client";

import { useActionState } from "react";
import { requestHumanReviewVerificationAction } from "@/lib/talent-directory/actions";
import { TextField, Button } from "@/components/ui";

const initialState: { status: "idle" | "success" | "error"; message: string } = {
  status: "idle",
  message: "",
};

/**
 * The higher-cost, human-reviewed tier (0141/0142) alongside the AI-only
 * VerificationPanel button. target role/industry are optional — they only
 * feed talent_verification_review_queue's soft expertise-match ranking
 * (0142's own header, design decision 2), never a hard requirement.
 */
export function HumanReviewForm() {
  const [state, formAction, pending] = useActionState(requestHumanReviewVerificationAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <TextField label="Target role (optional)" name="targetRole" placeholder="Backend Engineer" />
      <TextField label="Target industry (optional)" name="targetIndustry" placeholder="Fintech" />
      <Button type="submit" variant="secondary" disabled={pending}>
        Request human review
      </Button>
      {state.message && (
        <p className={`text-[13px] ${state.status === "error" ? "text-rust" : "text-green"}`}>{state.message}</p>
      )}
    </form>
  );
}
