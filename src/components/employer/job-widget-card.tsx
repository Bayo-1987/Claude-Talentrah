"use client";

import { useActionState, useState } from "react";
import { saveJobWidgetSettingsAction, type WidgetSettingsState } from "@/lib/employer/widget-actions";
import { BorderedCard, Button, SelectField } from "@/components/ui";

const COUNTS = Array.from({ length: 20 }, (_, i) => String(i + 1));

/**
 * Company Profile: show this company's open jobs on its own website (employer job-list widget, plan v2.1).
 *
 * The switch is OFF until the employer turns it on, and nothing is public until the organisation is verified (the embed page shows a neutral "No open jobs right now" for an
 * unverified one, whatever the switch says). The snippet and the preview use the SAVED state: a change is live for the preview after Save, and on a website within seconds
 * (the embed page is purged on every save and on every posting change).
 */
export function JobWidgetCard({
  enabled,
  maxItems,
  verified,
  snippet,
  previewSrc,
}: {
  enabled: boolean;
  maxItems: number;
  verified: boolean;
  snippet: string;
  previewSrc: string;
}) {
  const [state, formAction, pending] = useActionState<WidgetSettingsState, FormData>(saveJobWidgetSettingsAction, null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const error = state && "error" in state ? state.error : null;
  const saved = state && "ok" in state;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <BorderedCard className="p-6" data-testid="job-widget-card">
      <h2 className="font-display text-[20px] font-medium text-ink">Show your jobs on your website</h2>
      <p className="mt-1.5 max-w-[60ch] font-body text-[13.5px] text-ink-soft">
        Paste one line into your own site and it lists your open Talentrah jobs, newest first. Visitors see the job title, location, type and date, and each job links to its Talentrah
        page. Applicants and applications are never shown.
      </p>

      {!verified && (
        <p className="mt-3 border-[1.5px] border-amber px-3.5 py-2.5 font-body text-[13.5px] text-ink">
          Your company isn&apos;t verified yet, so the list stays empty on your website until it is.
        </p>
      )}

      <form action={formAction} className="mt-5 flex flex-col gap-4">
        <label className="flex min-h-[44px] items-center gap-3 font-body text-[14px] text-ink">
          <input type="checkbox" name="enabled" defaultChecked={enabled} className="h-5 w-5 accent-[var(--ink)]" />
          Show my open jobs on my website
        </label>
        <div className="max-w-[240px]">
          <SelectField label="Most jobs to show" name="maxItems" defaultValue={String(maxItems)} options={COUNTS} />
        </div>
        {error && <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">{error}</p>}
        {saved && !error && (
          <p className="border-[1.5px] border-green px-3.5 py-2.5 text-[13.5px] text-ink" role="status">
            Saved.
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      <div className="mt-7 border-t border-line pt-5">
        <h3 className="font-body text-[13px] font-bold tracking-[0.08em] text-ink uppercase">Your code</h3>
        <textarea
          readOnly
          rows={3}
          value={snippet}
          aria-label="Embed code for your website"
          className="mt-2 w-full border-[1.5px] border-ink bg-card p-3 font-mono text-[12.5px] text-ink"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={copy}>
            Copy code
          </Button>
          <span role="status" className="font-body text-[13px] text-ink-soft">
            {copied === "yes" ? "Copied." : copied === "failed" ? "Couldn't copy: select the code above and copy it." : ""}
          </span>
        </div>
        <p className="mt-3 max-w-[60ch] font-body text-[12.5px] text-ink-soft">
          If your website uses a strict Content Security Policy, allow this site to be framed: <code className="font-mono">frame-src https://www.talentrah.com</code>. The frame fills the width you give it
          and scrolls inside the height you set (480 above).
        </p>
      </div>

      <div className="mt-6">
        <h3 className="font-body text-[13px] font-bold tracking-[0.08em] text-ink uppercase">Preview</h3>
        {enabled ? (
          <iframe
            src={previewSrc}
            title="Preview of your jobs widget"
            width="100%"
            height="360"
            loading="lazy"
            className="mt-2 w-full border-[1.5px] border-ink"
          />
        ) : (
          <p className="mt-2 font-body text-[13.5px] text-ink-soft">Switch the widget on and save to see a preview.</p>
        )}
      </div>
    </BorderedCard>
  );
}
