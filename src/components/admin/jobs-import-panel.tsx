"use client";

import { useState } from "react";
import { Button, BorderedCard, EyebrowLabel } from "@/components/ui";
import { useCatchUpFile } from "@/lib/forms/use-catch-up-file";

type Counts = {
  rows: number;
  importable: number;
  importableByKind: { link: number; emailPlusLink: number; emailOnly: number };
  batches: number;
  skippedByReason: Record<string, number>;
  inFileDuplicates: number;
  alreadyOnTalentrah: number;
};
type Preview = {
  sha12: string;
  sourceKey: string;
  counts: Counts;
  lines: { line: number; title: string; company: string; batch: number | null; reason: string }[];
  truncated: boolean;
  previewCsv: string;
  notice: string;
};
type Answer = { ok: boolean; message: string };

/**
 * The page's panel: choose a CSV (the same 17 columns as the jobs sheet), see a PREVIEW that writes nothing, then tick and confirm. The server recomputes the plan from the file when
 * you confirm and refuses if the numbers differ from the ones shown here; nothing in this component decides what is written. No address is ever shown: the server leaves them out.
 */
export function JobsImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  // A file chosen before the page hydrated is still in the input: the hook acts on it on mount (issue #591).
  const { inputRef, onChange } = useCatchUpFile({
    onFiles: (files) => {
      setFile(files[0] ?? null);
      setPreview(null);
      setAnswer(null);
    },
    multiple: false,
  });

  async function post(path: "preview" | "confirm", extra: Record<string, string> = {}) {
    if (!file) return null;
    const form = new FormData();
    form.set("file", file);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    const res = await fetch(`/admin/jobs-import/${path}`, { method: "POST", body: form });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  }

  async function runPreview() {
    setBusy(true);
    setAnswer(null);
    setPreview(null);
    setTick(false);
    try {
      const r = await post("preview");
      if (r?.json && r.json.ok === true) setPreview(r.json.preview as Preview);
      else setAnswer({ ok: false, message: typeof r?.json?.message === "string" ? r.json.message : "No answer came back. Nothing was written." });
    } catch {
      setAnswer({ ok: false, message: "The request did not reach the server. Nothing was written." });
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!preview) return;
    setBusy(true);
    setAnswer(null);
    try {
      const r = await post("confirm", { sha12: preview.sha12, importable: String(preview.counts.importable), batches: String(preview.counts.batches), tick: tick ? "on" : "" });
      const message = typeof r?.json?.message === "string" ? r.json.message : "No answer came back. Check the public feed before trying again.";
      setAnswer({ ok: r?.json?.ok === true, message });
      if (r?.json?.ok === true) setPreview(null);
    } catch {
      setAnswer({ ok: false, message: "The request did not reach the server. Check the public feed before trying again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <BorderedCard className="flex flex-col gap-4 p-5">
        <EyebrowLabel>Upload a jobs sheet</EyebrowLabel>
        <p className="text-[14px] text-ink-soft">
          A CSV with the same 17 columns as the jobs sheet. <strong className="text-ink">Rows you confirm go live on the public feed at once.</strong> Nothing is written by the preview
          below, and it shows no address. A file may be up to 2 MB and 1,000 rows.
        </p>
        <label className="flex flex-col gap-2 text-[14px]" htmlFor="jobs-import-file">
          <span className="font-semibold">CSV file</span>
          <input
            id="jobs-import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="min-h-[44px] border-[1.5px] border-ink bg-card p-2"
            ref={inputRef}
            onChange={onChange}
          />
        </label>
        <div>
          <Button type="button" disabled={busy || !file} onClick={runPreview}>
            {busy && !preview ? "Working…" : "Preview"}
          </Button>
        </div>
      </BorderedCard>

      {preview && (
        <BorderedCard className="flex flex-col gap-4 p-5" data-testid="jobs-import-preview">
          <EyebrowLabel>Preview</EyebrowLabel>
          <p className="text-[14px]">
            {preview.counts.rows} rows. <strong>{preview.counts.importable} would be added</strong> in {preview.counts.batches} batch(es): {preview.counts.importableByKind.link} with an apply link,{" "}
            {preview.counts.importableByKind.emailPlusLink} with a link and an e-mail address, {preview.counts.importableByKind.emailOnly} with an e-mail address only.{" "}
            {preview.counts.inFileDuplicates} repeat an earlier row in the file; {preview.counts.alreadyOnTalentrah} are already on Talentrah.
          </p>
          {Object.keys(preview.counts.skippedByReason).length > 0 && (
            <ul className="list-disc pl-5 text-[13.5px] text-ink-soft">
              {Object.entries(preview.counts.skippedByReason)
                .sort()
                .map(([reason, n]) => (
                  <li key={reason}>
                    {n} skipped: {reason}
                  </li>
                ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-1.5 pr-3">Line</th>
                  <th className="py-1.5 pr-3">Title</th>
                  <th className="py-1.5 pr-3">Company</th>
                  <th className="py-1.5 pr-3">Batch</th>
                  <th className="py-1.5">Reason skipped</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.line} className="border-b border-line">
                    <td className="py-1.5 pr-3">{l.line}</td>
                    <td className="py-1.5 pr-3">{l.title}</td>
                    <td className="py-1.5 pr-3">{l.company}</td>
                    <td className="py-1.5 pr-3">{l.batch ?? ""}</td>
                    <td className="py-1.5">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.truncated && <p className="font-display text-[13.5px] italic text-ink-soft">Only the first lines are shown here. The counts above cover every row.</p>}
          <label className="flex min-h-[44px] items-start gap-3 text-[14px]">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={tick} onChange={(e) => setTick(e.target.checked)} />
            <span>I read the preview. I understand these rows go live on the public feed at once.</span>
          </label>
          <div>
            <Button type="button" disabled={busy || !tick || preview.counts.importable === 0} onClick={runConfirm}>
              {busy ? "Working…" : "Confirm and write"}
            </Button>
          </div>
        </BorderedCard>
      )}

      {answer && (
        <p role="status" className={"border-[1.5px] px-3.5 py-2.5 text-[14px] " + (answer.ok ? "border-ink bg-card" : "border-rust bg-rust-soft text-rust")}>
          {answer.message}
        </p>
      )}
    </section>
  );
}
