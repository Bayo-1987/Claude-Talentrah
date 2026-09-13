"use client";

import { useActionState } from "react";
import { updateCompanyProfileAction, type EmployerActionState } from "@/lib/employer/actions";
import { BorderedCard, Button, TextField } from "@/components/ui";

export function CompanyProfileForm({
  initial,
  verificationNote,
}: {
  initial: {
    name: string;
    domain: string;
    description: string;
    logoUrl: string;
  };
  /** Explains the current verification state and what would change it. */
  verificationNote: string;
}) {
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(
    updateCompanyProfileAction,
    null,
  );
  const error = state && "error" in state ? state.error : null;
  const saved = state && "ok" in state;

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="border-[1.5px] border-green bg-[oklch(95%_0.03_152)] px-3.5 py-2.5 text-[13.5px] text-ink">
          Saved.
        </p>
      )}

      <BorderedCard className="p-6">
        <form action={formAction} className="flex flex-col gap-5">
          <TextField label="Company name" name="name" required defaultValue={initial.name} />
          <div className="flex flex-col gap-1.5">
            <TextField
              label="Company website domain"
              name="domain"
              defaultValue={initial.domain}
              placeholder="e.g. zariadigital.com"
            />
            <p className="font-body text-[12.5px] text-ink-soft">{verificationNote}</p>
          </div>
          <TextField
            label="What the company does"
            name="description"
            defaultValue={initial.description}
            placeholder="One or two sentences"
          />
          <TextField
            label="Logo URL (optional)"
            name="logoUrl"
            type="url"
            defaultValue={initial.logoUrl}
            placeholder="https://"
          />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      </BorderedCard>
    </div>
  );
}
