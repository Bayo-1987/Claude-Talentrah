"use client";

import { TextField } from "@/components/ui";

/**
 * "How should people apply?" (PR-E2b). Controlled by the form, because choosing "By email" hides the screening questions and the assessment (they are not used for such a job) and
 * the form needs to know. The server decides everything (src/lib/employer/apply-method.ts); this only collects the choice and says plainly what it means.
 */
export function ApplyMethodField({
  method,
  onMethodChange,
  address,
  onAddressChange,
  confirmed,
  onConfirmedChange,
}: {
  method: "talentrah" | "email";
  onMethodChange: (next: "talentrah" | "email") => void;
  address: string;
  onAddressChange: (next: string) => void;
  confirmed: boolean;
  onConfirmedChange: (next: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3 border border-line p-4">
      <legend className="px-1 font-body text-[13px] font-semibold text-ink">How should people apply?</legend>
      <label className="flex min-h-10 items-center gap-3 font-body text-[14px] text-ink">
        <input type="radio" name="applyMethod" value="talentrah" checked={method === "talentrah"} onChange={() => onMethodChange("talentrah")} className="h-4 w-4" />
        On Talentrah
      </label>
      <label className="flex min-h-10 items-center gap-3 font-body text-[14px] text-ink">
        <input type="radio" name="applyMethod" value="email" checked={method === "email"} onChange={() => onMethodChange("email")} className="h-4 w-4" />
        By email
      </label>
      {method === "email" && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <TextField
            name="applyEmail"
            type="email"
            label="Email address for applications"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder="careers@yourcompany.com"
            autoComplete="off"
          />
          <label className="flex min-h-10 items-start gap-3 font-body text-[13.5px] text-ink">
            <input type="checkbox" name="applyEmailConfirm" checked={confirmed} onChange={(event) => onConfirmedChange(event.target.checked)} className="mt-1 h-4 w-4" />
            I confirm this address is ours and may be shown publicly
          </label>
          <p className="font-body text-[12.5px] text-ink-soft">
            Job seekers see this address only behind an &ldquo;Apply by email&rdquo; button and a &ldquo;Copy address&rdquo; button, but anyone who uses them can read it, including automated tools.
          </p>
          <p className="font-body text-[12.5px] text-ink-soft">
            Talentrah does not forward resumes. Applications sent by email do not appear in your Talentrah dashboard, so this job has no applicant list, screening questions or resume checks.
          </p>
        </div>
      )}
    </fieldset>
  );
}
