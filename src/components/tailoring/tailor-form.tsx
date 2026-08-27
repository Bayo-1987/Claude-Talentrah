"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, EyebrowLabel, BorderedCard } from "@/components/ui";
import { ResumeDocument } from "@/components/resume-builder/resume-document";
import type { TailoringResult } from "@/lib/tailoring/types";

type ApiResult = {
  resumeId: string;
  coverLetterResumeId: string | null;
  result: TailoringResult;
  isFreeTrial: boolean;
  creditsSpent: number;
};

export function TailorForm({
  jobId,
  initialJdText,
  defaultCoverLetter = false,
}: {
  jobId?: string;
  initialJdText: string;
  /**
   * Pre-ticks "also write a cover letter". Set by /tailor?coverLetter=1, which
   * is how the job card's "Draft intro message" differs from "Tailor my
   * resume" — without it both land on an identical page in an identical state
   * and the second item is decoration.
   */
  defaultCoverLetter?: boolean;
}) {
  const [jdText, setJdText] = useState(initialJdText);
  const [includeCoverLetter, setIncludeCoverLetter] = useState(defaultCoverLetter);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/tailoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText, jobPostingId: jobId, includeCoverLetter }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setData(json);
      setStatus("idle");
    } catch {
      setError("Couldn't reach Farah — check your connection and try again.");
      setStatus("error");
    }
  }

  if (data) {
    const { result, isFreeTrial, creditsSpent, resumeId, coverLetterResumeId } = data;
    return (
      <div className="flex flex-col gap-8">
        <p className="text-[13px] italic text-ink-soft">
          {isFreeTrial
            ? "This one was on the house — your free tailoring run."
            : `${creditsSpent} credits used.`}
        </p>

        {/*
          Truncation used to be silent, which meant a weaker result from a
          long JD read as Farah being bad rather than as us having dropped
          part of the input. Shown above the results, not buried under them,
          because it changes how everything below should be read.
        */}
        {result.jdTruncation && (
          <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-ink">
            <span className="font-semibold">Heads up — that job description was shortened.</span>{" "}
            It was {result.jdTruncation.originalChars.toLocaleString()} characters and Farah used
            the first {result.jdTruncation.usedChars.toLocaleString()}. Everything below is based
            on that opening section. If the parts that matter most sit further down, paste just
            that section and run it again.
          </p>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div>
              <EyebrowLabel size="sm">ATS score</EyebrowLabel>
              <div className="mt-1 font-display text-[40px] leading-none">
                {result.atsScore}
                <span className="text-[18px]">%</span>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5">
                {result.atsFixes.map((fix, i) => (
                  <li key={i} className="text-[13.5px] text-ink-soft">
                    · {fix}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <EyebrowLabel size="sm">Gap analysis</EyebrowLabel>
              <div className="mt-2 flex flex-col gap-1.5">
                {result.gapAnalysis.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[13.5px]">
                    <span
                      className="font-display italic"
                      style={{ color: item.status === "matched" ? "var(--green)" : "var(--amber)" }}
                    >
                      {item.status === "matched" ? "✓" : "△"}
                    </span>
                    <span className="text-ink-soft">
                      {item.keyword}
                      {item.note && ` — ${item.note}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {result.coverLetter && (
              <div>
                <EyebrowLabel size="sm">Cover letter</EyebrowLabel>
                <BorderedCard className="mt-2 whitespace-pre-wrap p-4 text-[13.5px] leading-relaxed text-ink-soft">
                  {result.coverLetter}
                </BorderedCard>
              </div>
            )}

            <div className="flex items-center gap-4">
              <Link href={`/resume-builder/edit?resumeId=${resumeId}`} className="text-[13.5px] font-semibold underline underline-offset-2">
                Edit this resume →
              </Link>
              {coverLetterResumeId && (
                <Link href={`/resume-builder/preview?resumeId=${coverLetterResumeId}`} className="text-[13.5px] font-semibold underline underline-offset-2">
                  View cover letter →
                </Link>
              )}
            </div>
          </div>

          <div className="border-[1.5px] border-ink">
            <ResumeDocument resume={result.tailoredResume} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <textarea
        value={jdText}
        onChange={(e) => setJdText(e.target.value)}
        rows={10}
        required
        minLength={50}
        placeholder="Paste the full job description here…"
        className="border-[1.5px] border-ink bg-card p-4 font-body text-[14.5px] outline-none focus:border-rust"
      />
      <label className="flex items-center gap-2 text-[13.5px] text-ink-soft">
        <input
          type="checkbox"
          checked={includeCoverLetter}
          onChange={(e) => setIncludeCoverLetter(e.target.checked)}
          className="h-4 w-4 accent-[var(--ink)]"
        />
        Also write a cover letter
      </label>
      {error && <p className="text-[13.5px] text-rust">{error}</p>}
      <Button type="submit" disabled={status === "loading"} className="self-start">
        {status === "loading" ? "Farah is working on it…" : "Tailor my resume"}
      </Button>
    </form>
  );
}
