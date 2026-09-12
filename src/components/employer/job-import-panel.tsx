"use client";

import { useState } from "react";
import { importJobFromUrlAction } from "@/lib/employer/job-import/action";
import type { ExtractedJobFields, ExtractionMethod } from "@/lib/employer/job-import/types";
import { Button, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * "Import from URL" (send-136) — an alternative on-ramp into JobPostingForm,
 * not a replacement for it. This never submits anything on its own: a
 * successful import calls `onImported` with fields the parent feeds into
 * JobPostingForm's `initial` prop, and the employer still has to review,
 * edit, and press the form's own "Publish job" button — nothing here writes
 * to `job_postings`.
 *
 * Deliberately a plain button + local state, not a `<form action={...}>`
 * Server Action wiring the way JobPostingForm itself uses `useActionState` —
 * that pattern fits a submission whose only outcome is success/redirect or
 * an inline error; this one needs to receive a VALUE (the extracted fields)
 * back into this component's own state to hand upward, which
 * useActionState's redirect-or-error shape doesn't carry.
 */
export function JobImportPanel({
  onImported,
}: {
  onImported: (fields: ExtractedJobFields, method: ExtractionMethod) => void;
}) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  async function handleImport() {
    const trimmed = url.trim();
    if (!trimmed) {
      setMessage({ tone: "error", text: "Paste a URL first." });
      return;
    }
    setPending(true);
    setMessage(null);

    const result = await importJobFromUrlAction(trimmed);
    setPending(false);

    if (!result.ok) {
      // CLAUDE.md-required degrade path: never a dead end, always a clear
      // message pointing back at the blank form that is still right there
      // below this panel, untouched.
      setMessage({ tone: "error", text: `${result.message} Paste the details in below.` });
      return;
    }

    onImported(result.fields, result.method);
    const missingCount = Object.values(result.fields).filter((v) => v === null).length;
    setMessage({
      tone: "info",
      text:
        result.method === "structured-data"
          ? "Imported from that listing's own job data. Review everything below before publishing."
          : missingCount > 0
            ? "Imported what we could find on that page. Review it, and fill in anything left blank below."
            : "Imported from that page. Review everything below before publishing.",
    });
  }

  return (
    <div className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-5">
      <div>
        <p className="font-body text-[13px] font-semibold text-ink-soft">Import from URL</p>
        <p className="mt-1 font-body text-[13px] leading-[1.5] text-ink-soft">
          Paste a link to your careers page or an existing listing you&rsquo;ve already written —
          we&rsquo;ll pull in what we can find below, for you to review and edit before publishing.
        </p>
      </div>
      <div className="flex flex-col gap-3 min-[560px]:flex-row min-[560px]:items-end">
        <div className="flex-1">
          <TextField
            label="Job listing URL"
            name="importUrl"
            type="url"
            placeholder="https://example.com/careers/backend-engineer"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleImport();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" onClick={() => void handleImport()} disabled={pending}>
          {pending ? "Importing…" : "Import"}
        </Button>
      </div>
      {message && (
        <p className={cn("font-body text-[13px]", message.tone === "error" ? "text-coral" : "text-ink-soft")}>
          {message.text}
        </p>
      )}
    </div>
  );
}
