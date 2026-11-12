"use client";

import { TextField } from "@/components/ui";
import { ATS_EXACT_HOSTS, ATS_TENANT_SUFFIXES } from "@/lib/jobs/apply-link";

/** The host of what was typed, when it is one of the applicant-tracking hosts (so the careers-page tick can name it); null otherwise. The SERVER still judges everything. */
function atsHostOf(text: string): string | null {
  try {
    const host = new URL(text.trim()).hostname.toLowerCase();
    return ATS_EXACT_HOSTS.includes(host) || ATS_TENANT_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`)) ? host : null;
  } catch {
    return null;
  }
}

/**
 * "How should people apply?" (PR-E2b; the third choice, "On our career site", is PR-E4). Controlled by the form, because choosing "By email" hides the screening questions and the assessment (they are not used for such a job) and
 * the form needs to know. The server decides everything (src/lib/employer/apply-method.ts); this only collects the choice and says plainly what it means.
 */
export function ApplyMethodField({
  method,
  onMethodChange,
  address,
  onAddressChange,
  confirmed,
  onConfirmedChange,
  linkUrl = "",
  onLinkUrlChange = () => {},
  linkConfirmed = false,
  onLinkConfirmedChange = () => {},
  companyDomain = null,
  companyVerified = false,
}: {
  method: "talentrah" | "email" | "link";
  onMethodChange: (next: "talentrah" | "email" | "link") => void;
  address: string;
  onAddressChange: (next: string) => void;
  confirmed: boolean;
  onConfirmedChange: (next: boolean) => void;
  /** PR-E4. All optional so a caller that offers only the first two choices is unchanged. */
  linkUrl?: string;
  onLinkUrlChange?: (next: string) => void;
  linkConfirmed?: boolean;
  onLinkConfirmedChange?: (next: boolean) => void;
  /** The verified company's domain, or null. Used for the hint only; the server decides. */
  companyDomain?: string | null;
  companyVerified?: boolean;
  /** Accepted for symmetry with the page; the name is used by the server for the warning, not shown here. */
  companyName?: string | null;
}) {
  const atsHost = method === "link" ? atsHostOf(linkUrl) : null;
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
      <label className="flex min-h-10 items-center gap-3 font-body text-[14px] text-ink">
        <input type="radio" name="applyMethod" value="link" checked={method === "link"} onChange={() => onMethodChange("link")} className="h-4 w-4" />
        On our career site
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
      {method === "link" && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <TextField
            name="applyLinkUrl"
            type="url"
            label="Address of your careers page"
            value={linkUrl}
            onChange={(event) => onLinkUrlChange(event.target.value)}
            placeholder={companyDomain ? `https://careers.${companyDomain}/jobs` : "https://boards.greenhouse.io/yourcompany"}
            autoComplete="off"
          />
          <p className="font-body text-[12.5px] text-ink-soft">
            {companyVerified && companyDomain
              ? `Use a page on your own website (${companyDomain}), or your applicant tracking page on Greenhouse, Lever, Workable, Ashby, SmartRecruiters, BambooHR, Recruitee or Teamtailor. The address must start with https://.`
              : "Your company isn't verified yet, so only an applicant tracking page can be used (Greenhouse, Lever, Workable, Ashby, SmartRecruiters, BambooHR, Recruitee or Teamtailor). Verify your company to use your own website."}
          </p>
          {atsHost && (
            <label className="flex min-h-10 items-start gap-3 font-body text-[13.5px] text-ink">
              <input type="checkbox" name="applyLinkConfirm" checked={linkConfirmed} onChange={(event) => onLinkConfirmedChange(event.target.checked)} className="mt-1 h-4 w-4" />
              {`This is our own careers page on ${atsHost}`}
            </label>
          )}
          <p className="font-body text-[12.5px] text-ink-soft">
            Job seekers who choose &ldquo;Apply on company site&rdquo; leave Talentrah. They see only the name of the site it opens, never the full address.
          </p>
          <p className="font-body text-[12.5px] text-ink-soft">
            Talentrah does not receive these applications. They do not appear in your Talentrah dashboard, so this job has no applicant list, screening questions or resume checks.
          </p>
        </div>
      )}
    </fieldset>
  );
}
