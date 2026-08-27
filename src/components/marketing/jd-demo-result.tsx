import Link from "next/link";
import { EyebrowLabel, MatchTierBadge, buttonClasses } from "@/components/ui";
import type { GapAnalysisItem, StructuredJdForTailoring } from "@/lib/tailoring/types";
import type { StructuredResume } from "@/lib/resume/types";

export interface JdDemoResultData {
  structuredJd: StructuredJdForTailoring;
  gapAnalysis: GapAnalysisItem[];
  tailoredResume: StructuredResume;
  atsScore: number;
  atsFixes: string[];
  jdTruncation: { originalChars: number; usedChars: number } | null;
}

/**
 * A real Farah result, in the same shape as the static example it replaces.
 *
 * Deliberately the same layout as `JdDemoExample` — score on the left, gap
 * analysis under it, a tailored-resume excerpt on the right. The static panel
 * is what a visitor has been looking at for the ten seconds before this
 * appears; changing the furniture at the same time as the content makes it
 * read as a different feature rather than as their answer.
 */
export function JdDemoResult({
  data,
  isSignedIn,
}: {
  data: JdDemoResultData;
  isSignedIn: boolean;
}) {
  const matched = data.gapAnalysis.filter((g) => g.status === "matched");
  const missing = data.gapAnalysis.filter((g) => g.status === "missing");
  const excerpt =
    data.tailoredResume.summary?.trim() ||
    data.tailoredResume.experience[0]?.description?.trim() ||
    "";

  return (
    <div className="mt-3 w-full max-w-[860px] border-[1.5px] border-ink bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-6 py-3.5">
        <EyebrowLabel>What Farah sent back</EyebrowLabel>
        {/*
          The framing is not decoration and it is not the same in both cases.
          For a stranger the number is about a sample persona, and saying so is
          the difference between a demo and a false claim. For a signed-in
          visitor it is their own resume, and the sample framing would be
          actively wrong — so it is written separately rather than
          conditionally softened.
        */}
        <span className="font-display text-[12.5px] italic text-ink-soft">
          {isSignedIn
            ? "Scored against your saved resume"
            : "Scored against a sample resume — not yours"}
        </span>
      </div>

      <div className="flex flex-col gap-6 p-7.5 min-[901px]:flex-row">
        <div className="flex flex-1 flex-col gap-4.5 min-[901px]:pr-7.5">
          <div>
            <EyebrowLabel className="mb-2.5 block">
              ATS score{data.structuredJd.title ? ` — ${data.structuredJd.title}` : ""}
            </EyebrowLabel>
            {/*
              MatchTierBadge, so this number lands in the same three tiers as
              every score elsewhere in the product. An ATS score is not a match
              score — but it is a 0–100 quality read shown to the same person,
              and giving it a fourth vocabulary is exactly what CLAUDE.md
              forbids.
            */}
            <MatchTierBadge score={data.atsScore} variant="display" />
          </div>

          <div className="flex flex-col gap-3 border-t border-dashed border-line pt-3.5">
            {matched.slice(0, 2).map((item) => (
              <div key={`m-${item.keyword}`} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 font-display italic text-green">✓</span>
                <span className="text-[13.5px] text-ink-soft">
                  {item.keyword} — {item.note?.trim() || "strong match"}
                </span>
              </div>
            ))}
            {missing.slice(0, 3).map((item) => (
              <div key={`x-${item.keyword}`} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 font-display italic text-amber">△</span>
                <span className="text-[13.5px] text-ink-soft">
                  {item.keyword} — {item.note?.trim() || "not found in the resume"}
                </span>
              </div>
            ))}
            {matched.length === 0 && missing.length === 0 && (
              <span className="text-[13.5px] text-ink-soft">
                Farah didn&apos;t pull specific keywords out of that one.
              </span>
            )}
          </div>
        </div>

        <div className="w-px flex-shrink-0 bg-line" />

        <div className="flex flex-1 flex-col justify-center gap-3.5 min-[901px]:pl-7.5">
          <div className="border border-line bg-paper p-4">
            <EyebrowLabel className="mb-2 block">Tailored resume preview</EyebrowLabel>
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              {excerpt || "Farah rewrote the resume but had nothing to quote back here."}
            </p>
          </div>

          {/*
            Truncation is never silent — the same rule the signed-in flow
            follows. A shortened JD produces a weaker result, and without
            saying so the visitor reads that as the product being bad rather
            than as us having dropped half their input.
          */}
          {data.jdTruncation && (
            <p className="font-display text-[12px] italic text-amber">
              That description was long — Farah read the first{" "}
              {data.jdTruncation.usedChars.toLocaleString()} of{" "}
              {data.jdTruncation.originalChars.toLocaleString()} characters.
            </p>
          )}

          {isSignedIn ? (
            <Link href="/resume-builder" className={buttonClasses("secondary", "sm", "no-underline self-start")}>
              Open in Resume Builder
            </Link>
          ) : (
            <>
              <div className="font-display text-[12.5px] italic text-ink-soft">
                Preview only — create a free account to run this against your own resume, export
                and apply.
              </div>
              <Link href="/signup" className={buttonClasses("primary", "sm", "no-underline self-start")}>
                Create a free account
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
