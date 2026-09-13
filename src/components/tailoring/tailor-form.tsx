"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, EyebrowLabel, Card } from "@/components/ui";
import { ResumeDocument } from "@/components/resume-builder/resume-document";
import type { StructuredResume } from "@/lib/resume/types";
import type { ProposedAddition, TailoringResult } from "@/lib/tailoring/types";
import type { RankedRecommendation } from "@/lib/courses/match";
import { buildAcceptedAdditions } from "@/lib/tailoring/accepted-payload";

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

/**
 * send-latency-1 — a specific, step-based loading state in place of the bare
 * "Farah is working on it…" this replaced. This one LLM call (JD parse, gap
 * analysis, and the tailored rewrite together) returns a single JSON object,
 * so it can't stream token-by-token the way Farah's free-text chat now does
 * (chat/route.ts) — a partial JSON document isn't safely parseable or
 * displayable mid-stream. Splitting this into a separate streamed narration
 * call plus the real structured extraction was the other option on the
 * table; decided against it FOR NOW because it's a second LLM call on the
 * product's core loop (real added cost per §6.9, and a worse worst case if
 * the narration call itself is slow), for a UX gain this sequence already
 * gets most of the way to. Revisit if real usage shows this run's actual
 * latency (not the narration idea) is still the bigger problem.
 *
 * Advances forward on a timer while the call is in flight — NOT tied to any
 * real signal from the server, since a single opaque call has no
 * sub-progress to report. Stops at the last step rather than looping, so a
 * genuinely slow run never looks like it silently restarted. Deliberately no
 * time estimate on any line — CLAUDE.md's own content rule against
 * unmeasured specific promises ("in 10 seconds") applies exactly as much
 * here as to a piece of AI-generated copy.
 */
const TAILORING_STEPS = [
  "Reading your resume…",
  "Comparing it to the job description…",
  "Checking for matched and missing skills…",
  "Drafting your tailored resume…",
] as const;

const TAILORING_STEP_INTERVAL_MS = 2200;

/** One line describing where a proposed addition would land, for the review list. */
function additionTarget(addition: ProposedAddition, tailoredResume: StructuredResume): string {
  if (addition.section === "skills") return "Add to Skills";
  const entry =
    typeof addition.experienceIndex === "number" ? tailoredResume.experience[addition.experienceIndex] : undefined;
  return entry ? `Rewrite: ${entry.title} at ${entry.company}` : "Rewrite an experience entry";
}

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
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (status !== "loading") return;
    const id = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, TAILORING_STEPS.length - 1));
    }, TAILORING_STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  // Review-flow state — see src/lib/tailoring/grounding.ts for why this
  // exists at all. Nothing in `proposedAdditions` reaches the saved resume
  // until it's in `checkedIds` AND the accept call below has succeeded.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [applyStatus, setApplyStatus] = useState<"idle" | "saving" | "error">("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  /*
   * Keyed by addition.id, only present once a user has actually typed —
   * absent means "use Farah's original wording unchanged". Editing here
   * doesn't cross a new trust boundary: /api/tailoring/accept-additions's
   * own header explains that a candidate editing their OWN accepted text is
   * exactly as trusted as any ordinary resume edit already is; this only
   * changes what `accepted` carries client-side, before it's sent.
   */
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setStepIndex(0);
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
      setCheckedIds(new Set());
      setAppliedIds(new Set());
      setEditedTexts({});
      setStatus("idle");
    } catch {
      setError("Couldn't reach Farah — check your connection and try again.");
      setStatus("error");
    }
  }

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApplyAdditions() {
    if (!data) return;
    const accepted = buildAcceptedAdditions(data.result.proposedAdditions ?? [], checkedIds, editedTexts);
    if (accepted.length === 0) return;

    setApplyStatus("saving");
    setApplyError(null);
    try {
      const res = await fetch("/api/tailoring/accept-additions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: data.resumeId, accepted }),
      });
      const json = await res.json();
      if (!res.ok) {
        setApplyError(json.error ?? "Couldn't save those changes.");
        setApplyStatus("idle");
        return;
      }
      // Reflect the merge locally right away — the preview and the saved
      // resume should never visibly disagree, even for the moment before a
      // reload.
      setData((prev) => (prev ? { ...prev, result: { ...prev.result, tailoredResume: json.resume } } : prev));
      setAppliedIds((prev) => new Set([...prev, ...accepted.map((a) => a.id)]));
      setCheckedIds(new Set());
      setApplyStatus("idle");
    } catch {
      setApplyError("Couldn't reach the server — check your connection and try again.");
      setApplyStatus("idle");
    }
  }

  if (data) {
    const { result, isFreeTrial, isPassCovered, creditsSpent, resumeId, coverLetterResumeId } = data;
    /*
     * `?? []`: this field is required in the real API's response shape
     * (tailorResumeToJob always sets it), but e2e tests that stub
     * `/api/tailoring` directly with `page.route()` predate this field and
     * mock the older response shape (see course-recommendations.spec.ts) —
     * without this guard, `undefined.filter()` throws and blanks the whole
     * result panel, which is a worse failure than just treating "field
     * absent" as "nothing proposed."
     */
    const pendingAdditions = (result.proposedAdditions ?? []).filter((a) => !appliedIds.has(a.id));
    const checkedCount = pendingAdditions.filter((a) => checkedIds.has(a.id)).length;

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
          <p className="border-[1.5px] border-coral bg-coral-soft px-4 py-3 text-[13.5px] text-ink">
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
              PROPOSED ADDITIONS — the review flow itself.
              See src/lib/tailoring/grounding.ts's header for the full
              incident this exists to prevent: a real run replaced 15 of 16
              genuine skills with a list including four the candidate never
              claimed, and invented experience bullets lifted from the JD.
              Nothing here has been written into `result.tailoredResume` —
              the preview on the right, and the resume already saved at
              `resumeId`, are both the SAFE version. Checking a box and
              saving is the only way anything below reaches either.
              Unchecked and un-applied by default: an opt-IN list, not an
              opt-out one.
            */}
            {pendingAdditions.length > 0 && (
              <div data-testid="proposed-additions">
                <EyebrowLabel size="sm">Worth adding? Your call</EyebrowLabel>
                <p className="mt-1 text-[12.5px] italic text-ink-soft">
                  Farah found these would strengthen the match, but none of them are on your base
                  resume yet — nothing here is added unless you check it and confirm.
                </p>
                <div className="mt-2 flex flex-col gap-2.5">
                  {pendingAdditions.map((addition) => {
                    const checkboxId = `addition-${addition.id}`;
                    return (
                      <div
                        key={addition.id}
                        className="flex items-start gap-2.5 border-[1.5px] border-line bg-card p-3 text-[13.5px]"
                      >
                        <input
                          type="checkbox"
                          id={checkboxId}
                          checked={checkedIds.has(addition.id)}
                          onChange={() => toggleChecked(addition.id)}
                          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--ink)]"
                        />
                        {/*
                          NOT one big <label> around the whole row, deliberately
                          — a <label> forwards a click anywhere inside it
                          (including inside a nested textarea) to the checkbox
                          it's for, which would make placing a cursor to edit
                          also toggle the checkbox. The target line keeps that
                          click-to-toggle convenience via its own explicit
                          htmlFor; the textarea sits outside any label, fully
                          independent.
                        */}
                        <div className="min-w-0 flex-1">
                          <label htmlFor={checkboxId} className="block cursor-pointer font-semibold text-ink">
                            {additionTarget(addition, result.tailoredResume)}
                          </label>
                          <textarea
                            value={editedTexts[addition.id] ?? addition.text}
                            onChange={(e) =>
                              setEditedTexts((prev) => ({ ...prev, [addition.id]: e.target.value }))
                            }
                            rows={2}
                            aria-label={`Edit suggested text for ${additionTarget(addition, result.tailoredResume)}`}
                            className="mt-1 block w-full resize-y border border-line bg-bg p-1.5 font-body text-[13.5px] text-ink outline-none focus:border-coral"
                          />
                          <span className="mt-0.5 block text-[12px] italic text-ink-soft">{addition.reason}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {applyError && <p className="mt-2 text-[13px] text-coral">{applyError}</p>}
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  disabled={checkedCount === 0 || applyStatus === "saving"}
                  onClick={handleApplyAdditions}
                >
                  {applyStatus === "saving"
                    ? "Saving…"
                    : checkedCount > 0
                      ? `Add ${checkedCount} checked item${checkedCount === 1 ? "" : "s"} to my resume`
                      : "Add checked items to my resume"}
                </Button>
              </div>
            )}

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
                          className="text-[13.5px] font-semibold text-ink no-underline hover:text-coral hover:underline"
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
                <Card className="mt-2 whitespace-pre-wrap p-4 text-[13.5px] leading-relaxed text-ink-soft">
                  {result.coverLetter}
                </Card>
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
        className="border-[1.5px] border-ink bg-card p-4 font-body text-[14.5px] outline-none focus:border-coral"
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
      {error && <p className="text-[13.5px] text-coral">{error}</p>}
      <Button type="submit" disabled={status === "loading"} className="self-start">
        {status === "loading" ? "Working…" : "Tailor my resume"}
      </Button>
      {status === "loading" && (
        <p role="status" aria-live="polite" className="font-display text-[13px] italic text-ink-soft">
          {TAILORING_STEPS[stepIndex]}
        </p>
      )}
    </form>
  );
}
