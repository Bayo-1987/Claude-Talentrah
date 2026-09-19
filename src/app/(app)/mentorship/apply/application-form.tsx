"use client";

import { useActionState } from "react";
import { applyToBecomeMentorAction, updateMentorProfileAction } from "@/lib/mentorship/actions";
import { TextField, Button } from "@/components/ui";
import { RichMarkdownEditor } from "@/components/employer/rich-markdown-editor";
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
      {/*
        send-369 — same rich editor send-367 built for job descriptions, but
        with toolbar="minimal": a bio is a 1-3 sentence register, not a
        document, so no headings/lists/quote/rule — bold, italic, and the
        same bare-https:// autolink every RichMarkdownEditor already has.
      */}
      <RichMarkdownEditor
        id="bio"
        name="bio"
        label="Bio"
        defaultValue={existing?.bio ?? ""}
        toolbar="minimal"
        minHeightClassName="min-h-24"
      />

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
        defaultValue={existing?.yearsExperience ?? ""}
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
