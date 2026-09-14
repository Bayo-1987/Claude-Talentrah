"use client";

import { useActionState } from "react";
import { applyToBecomeMentorAction, updateMentorProfileAction } from "@/lib/mentorship/actions";
import { TextField, Button } from "@/components/ui";
import type { OwnMentorProfile } from "@/lib/mentorship/queries";

const initialState: { status: "idle" | "success" | "error"; message: string } = {
  status: "idle",
  message: "",
};

export function ApplicationForm({ existing }: { existing: OwnMentorProfile | null }) {
  const action = existing ? updateMentorProfileAction : applyToBecomeMentorAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="font-body text-[13px] font-semibold text-ink-soft">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={existing?.bio ?? ""}
          className="min-h-24 border-[1.5px] border-ink bg-card p-2.5 font-body text-[15px] text-ink"
        />
      </div>

      <TextField
        label="Roles you can speak to (comma-separated)"
        name="expertiseRoles"
        defaultValue={existing?.expertiseRoles.join(", ") ?? ""}
        placeholder="Product Manager, Software Engineer"
      />
      <TextField
        label="Industries (comma-separated)"
        name="expertiseIndustries"
        defaultValue={existing?.expertiseIndustries.join(", ") ?? ""}
        placeholder="Fintech, Healthcare"
      />
      <TextField
        label="Years of experience"
        name="yearsExperience"
        type="number"
        min={0}
      />
      <TextField
        label="Price per session, in Naira (leave blank if free/volunteer)"
        name="basePriceNgn"
        type="number"
        min={0}
        defaultValue={existing?.basePriceNgn ?? ""}
      />

      {state.message && (
        <p className={`text-[13px] ${state.status === "error" ? "text-rust" : "text-green"}`}>{state.message}</p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {existing ? "Save changes" : "Submit application"}
      </Button>
    </form>
  );
}
