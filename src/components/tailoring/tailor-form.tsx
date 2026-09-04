"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, EyebrowLabel, BorderedCard } from "@/components/ui";
import { ResumeDocument } from "@/components/resume-builder/resume-document";
import type { TailoringResult } from "@/lib/tailoring/types";
import type { RankedRecommendation } from "@/lib/courses/match";

type ApiResult = {
  resumeId: string;
  coverLetterResumeId: string | null;
  result: TailoringResult;
  isFreeTrial: boolean;
  isPassCovered: boolean;
  creditsSpent: number;
  /** Ranked by the M1 matcher, server-side. Usually empty — see below. */
  courseRecommendations?: RankedRecommendation[];
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
    const { result, isFreeTrial, isPassCovered, creditsSpent, resumeId, coverLetterResumeId } = data;
    return (
      <div className="flex flex-col gap-8">
        <p className="text-[13px] italic text-ink-soft">
          {isFreeTrial
            ? "This one was on the house — your free tailoring run."
            : isPassCovered
              ? "Included with your Pass — no credits used."
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

            {/*
              COURSES FOR THE GAPS, and only when there are any.

              The whole block is absent rather than empty-stated. A standing
              "no courses matched" line would be a permanent apology for the
              catalog's size on a screen whose subject is the user's resume,
              and the common case IS none — nine curated rows cannot cover most
              gap analyses, which M1's tests pin as correct rather than
              degraded. Silence reads as "nothing to add"; an empty state reads
              as "something is missing here".

              Capped at two by the ranker. A column of affiliate links under a
              paid result is the ad unit this deliberately is not.
            */}
            {data.courseRecommendations && data.courseRecommendations.length > 0 && (
              <div data-testid="course-recommendations">
                <EyebrowLabel size="sm">Courses for these gaps</EyebrowLabel>
                <div className="mt-2 flex flex-col">
                  {data.courseRecommendations.map((rec) => (
                    <div
                      key={rec.course.id}
                      data-testid="course-recommendation"
                      className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <a
                          href={rec.course.affiliate_url}
                          target="_blank"
                          /*
                            `sponsored` alongside the usual two. These carry an
                            affiliate ref, and saying so in the markup is the
                            same honesty the visible line below states in
                            words — not an SEO tactic.
                          */
                          rel="sponsored noopener noreferrer"
                          className="text-[13.5px] font-semibold text-ink no-underline hover:text-rust hover:underline"
                        >
                          {rec.course.title}
                        </a>
                        {/*
                          Names the gap it answers, verbatim as the model wrote
                          it — `matchedKeyword`, not the normalised tag. The
                          user recognises "React.js" from the list above; they
                          never saw "react".
                        */}
                        <div className="mt-0.5 text-[12.5px] text-ink-soft">
                          for {rec.matchedKeyword}
                        </div>
                      </div>
                      {rec.course.price_tier === "free" && (
                        <span className="flex-shrink-0 font-body text-[10px] font-bold tracking-[0.14em] text-green uppercase">
                          Free
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {/*
                  Said plainly, in the design system's quiet-aside voice. The
                  links are commercial and the reader is entitled to know that
                  before clicking rather than after.
                */}
                <p className="mt-2 font-display text-[11.5px] leading-[1.4] italic text-ink-soft">
                  Partner links. Talentrah may earn a commission — it doesn&apos;t
                  change what Farah recommends.
                </p>
              </div>
            )}

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
                <Link href={`/resume-builder/edit?resumeId=${coverLetterResumeId}`} className="text-[13.5px] font-semibold underline underline-offset-2">
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
