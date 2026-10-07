import { AUTO_APPLY_DAILY_SUBMIT_CAP, AUTO_APPLY_FREE_PER_WEEK, AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { creditsPhrase } from "@/lib/credits/price-labels";
import { describeMatchConfidence } from "@/lib/match-tier";
import { ACTIVATED_MEANING, SELF_REFERRAL_LINE, referralCapSentence, referralRewardHeadline, referralRewardWorth } from "@/lib/referrals/copy";

/**
 * The facts a page's chips carry, as pure builders (the loaders that read the user's own records are in page-facts-load.ts).
 *
 * Two outputs, kept apart on purpose:
 *   `facts`  every NUMBER a chip may quote: prices from the price list, allowances from configuration, this user's own counts, the scorer's own match figures. Plain text, no brackets, built only from our own
 *            catalog and our own records; it reaches the model in the <platform_facts> block (chat-prompt.ts).
 *   `data`   text a THIRD PARTY wrote (a job posting's title, company and skills; a scholarship's terms): returned separately, to be wrapped as untrusted data (data-block.ts). It never holds a number a chip should
 *            quote (no percentage, no price), so there is no second figure to prefer over the facts.
 */
export const MAX_PAGE_FACTS_CHARS = 1500;
/** The most third-party text a page chip adds to a request (the labelled data block). Longer is cut at this length, so a page full of listings cannot grow a request without bound. */
export const MAX_PAGE_DATA_CHARS = 3000;

/** A scored job as the loader reads it: the stored score and its explanation. The displayed figure and label are describeMatchConfidence's, never computed here. */
export interface ScoredJob {
  score: number;
  explanation: unknown;
}
export interface TopMatch extends ScoredJob {
  title: string;
  companyName: string;
}
export interface OpenScholarship {
  programName: string;
  provider: string;
  deadline: string | null;
}
export interface TrackedApplication {
  title: string;
  companyName: string;
  stage: string;
  daysSinceChange: number;
}
export interface QuotaView {
  submittedLast7d: number;
  freeRemaining: number;
  dailyRemaining: number;
  nextSubmissionCostsCredits: boolean;
  nextSubmissionCovered: boolean;
}

export type PageFactsInput =
  | { kind: "jobs"; /** undefined: no job asked about; null: a job was asked about and has no score. */ thisJob?: ScoredJob | null; top: TopMatch[]; unavailable?: boolean }
  | { kind: "scholarships"; open: OpenScholarship[]; detailText?: string; detailOpen?: boolean; unavailable?: boolean }
  | { kind: "resume-builder"; topRoles: Array<{ title: string; companyName: string }>; unavailable?: boolean }
  | { kind: "tailor" }
  | { kind: "tracker"; applications: TrackedApplication[]; focus?: TrackedApplication; unavailable?: boolean }
  | { kind: "auto-apply"; quota: QuotaView | null; unavailable?: boolean }
  | { kind: "mentorship" }
  | { kind: "talent-directory" }
  | { kind: "refer" };

export interface PageFacts {
  facts: string;
  /** Third-party text for the labelled untrusted block, or undefined when there is none. */
  data?: string;
}

const cap = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
/** A read that failed is NOT an empty result: the model is told the data could not be loaded, and to say so rather than guess. */
const unavailableLine = (what: string) => `This user's ${what} could not be loaded just now. Say so plainly and do not guess.`;
const PASS_NOTE = "An active Pass covers it, so it uses no credits while the Pass lasts.";

function matchLine(label: string, s: ScoredJob): string {
  const d = describeMatchConfidence(s.score, s.explanation);
  const words = d.label ?? (d.isUnscreened ? "Unscreened" : "no tier");
  return `- ${label}: ${d.displayScore}% ${words}`;
}

function missingSkills(explanation: unknown): string[] {
  const m = (explanation as { missingSkills?: unknown } | null)?.missingSkills;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string").slice(0, 5).map((x) => cap(oneLine(x), 40)) : [];
}

export function buildPageFacts(input: PageFactsInput): PageFacts {
  const lines: string[] = [];
  let data: string | undefined;

  switch (input.kind) {
    case "jobs": {
      if (input.unavailable) {
        lines.push(unavailableLine("match data"));
        break;
      }
      lines.push("Match numbers come only from Talentrah's scorer. Do not compute, adjust or round them:");
      if (input.thisJob === null) lines.push("- This job: no score yet.");
      else if (input.thisJob) lines.push(matchLine("This job", input.thisJob));
      if (input.top.length === 0) lines.push("- no top matches yet.");
      input.top.forEach((t, i) => lines.push(matchLine(`Match ${i + 1}`, t)));
      if (input.top.length > 0) {
        data = [
          "Top matches, best first (the postings' own words):",
          ...input.top.map((t, i) => {
            const gaps = missingSkills(t.explanation);
            return `${i + 1}. ${cap(oneLine(t.title), 100)} at ${cap(oneLine(t.companyName), 60)}${gaps.length ? ` — skills the posting asks for that your resume does not show: ${gaps.join(", ")}` : ""}`;
          }),
        ].join("\n");
      }
      break;
    }
    case "scholarships": {
      lines.push("Prices of the two credit actions (Talentrah's price list):");
      lines.push(`- Eligibility check: ${creditsPhrase(CREDIT_COSTS.scholarshipEligibilityCheck)}`);
      lines.push(`- Statement draft: ${creditsPhrase(CREDIT_COSTS.scholarshipSopDraft)}`);
      if (input.unavailable) {
        lines.push(unavailableLine("scholarship list"));
        break;
      }
      lines.push(input.open.length === 0 ? "There are no open scholarships listed right now." : `${input.open.length} open scholarships are listed, soonest closing first.`);
      if (input.detailOpen !== undefined) lines.push(input.detailOpen ? "This scholarship is open." : "This scholarship is closed.");
      const parts: string[] = [];
      if (input.open.length > 0) {
        parts.push("Open scholarships, soonest closing first:");
        for (const s of input.open) parts.push(`- ${cap(oneLine(s.programName), 100)} (${cap(oneLine(s.provider), 60)}), deadline ${s.deadline ?? "not published"}`);
      }
      if (input.detailText) parts.push("The scholarship being looked at, as published:", input.detailText);
      data = parts.length ? parts.join("\n") : undefined;
      break;
    }
    case "resume-builder": {
      lines.push("Price of the resume rewrite action (Talentrah's price list):");
      lines.push(`- Bullet rewrite: ${creditsPhrase(CREDIT_COSTS.bulletRewrite)}. ${PASS_NOTE}`);
      if (input.unavailable) {
        lines.push(unavailableLine("matched roles"));
        break;
      }
      lines.push(input.topRoles.length ? "The roles this user is matching against are listed in the data, best first." : "No matched roles are available yet.");
      if (input.topRoles.length) data = ["Roles the user is matching against, best first (the postings' own words):", ...input.topRoles.map((r, i) => `${i + 1}. ${cap(oneLine(r.title), 100)} at ${cap(oneLine(r.companyName), 60)}`)].join("\n");
      break;
    }
    case "tailor": {
      lines.push("Prices of the tailoring actions (Talentrah's price list):");
      lines.push(`- Tailor a resume: ${creditsPhrase(CREDIT_COSTS.tailoringRun)}`);
      lines.push(`- Cover letter: ${creditsPhrase(CREDIT_COSTS.coverLetterRun)}`);
      lines.push(PASS_NOTE);
      break;
    }
    case "tracker": {
      if (input.unavailable) {
        lines.push(unavailableLine("tracker"));
        break;
      }
      const n = input.applications.length;
      lines.push(n === 0 ? "The tracker is empty." : `The tracker holds ${n} ${n === 1 ? "application" : "applications"}, listed in the data.`);
      const rows = input.applications.map((a) => `- ${cap(oneLine(a.title), 100)} at ${cap(oneLine(a.companyName), 60)}: stage ${a.stage}, last changed ${a.daysSinceChange} ${a.daysSinceChange === 1 ? "day" : "days"} ago`);
      const parts: string[] = [];
      if (rows.length) parts.push("Applications in this user's tracker (the postings' own words):", ...rows);
      if (input.focus) parts.push(`The application in question: ${cap(oneLine(input.focus.title), 100)} at ${cap(oneLine(input.focus.companyName), 60)}, stage ${input.focus.stage}.`);
      data = parts.length ? parts.join("\n") : undefined;
      break;
    }
    case "auto-apply": {
      const q = input.quota;
      lines.push("Auto-Apply (Talentrah's configuration):");
      lines.push(`- Only postings scoring ${AUTO_APPLY_MIN_SCORE}% or higher (the Excellent tier) are queued. Nothing is submitted until you confirm each one.`);
      lines.push(`- Free allowance: ${AUTO_APPLY_FREE_PER_WEEK} confirmed applications a week (a rolling 7 days), then each one costs ${creditsPhrase(CREDIT_COSTS.autoApplySubmission)}. An active Pass covers it within a daily fair-use cap.`);
      lines.push(`- Daily cap: ${AUTO_APPLY_DAILY_SUBMIT_CAP} a day. Opening an external posting is always free.`);
      lines.push("- Auto-Apply never submits to an external posting: for one, it hands you off to the source site and the match is marked handed off, never applied. That costs nothing and does not count against the cap. Only a posting posted on Talentrah is submitted, and only when you confirm.");
      if (input.unavailable || q === null) {
        lines.push(unavailableLine("Auto-Apply count"));
        break;
      }
      lines.push("This user's own count:");
      lines.push(`- Used in the last 7 days: ${q.submittedLast7d}`);
      lines.push(`- Free runs left: ${q.freeRemaining}`);
      lines.push(`- Left today: ${q.dailyRemaining}`);
      lines.push(q.nextSubmissionCovered ? "- The next one is covered by an active Pass." : q.nextSubmissionCostsCredits ? `- The next one costs ${creditsPhrase(CREDIT_COSTS.autoApplySubmission)}.` : "- The next one is free.");
      break;
    }
    case "mentorship": {
      lines.push("Mentorship:");
      lines.push("- Mentor sessions are paid directly to the mentor, not with credits.");
      lines.push("- Each mentor's profile shows their own price and availability. You cannot see a mentor's calendar.");
      break;
    }
    case "talent-directory": {
      lines.push("Talent Directory review, the levels and what they cost (Talentrah's price list):");
      lines.push(`- Standard review (AI-graded): ${creditsPhrase(CREDIT_COSTS.talentDirectoryVerification)}`);
      lines.push(`- Human review (a paid review by a person): ${creditsPhrase(CREDIT_COSTS.talentDirectoryHumanReview)}`);
      break;
    }
    case "refer": {
      lines.push("Refer & Earn (Talentrah's configuration):");
      lines.push(`- ${referralRewardHeadline()} Worth ${referralRewardWorth()}.`);
      lines.push(`- ${referralCapSentence()}`);
      lines.push(`- ${ACTIVATED_MEANING}`);
      lines.push("- Nothing is paid at signup: the reward arrives when the invited person activates.");
      lines.push(`- ${SELF_REFERRAL_LINE}`);
      break;
    }
  }

  const facts = lines.join("\n");
  if (facts.length > MAX_PAGE_FACTS_CHARS) throw new Error(`page facts for ${input.kind} are ${facts.length} characters, over the cap of ${MAX_PAGE_FACTS_CHARS}`);
  return { facts, data: data === undefined ? undefined : cap(data, MAX_PAGE_DATA_CHARS) };
}
