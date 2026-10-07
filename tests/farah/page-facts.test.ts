/**
 * The facts a page's chips carry. Built on the SERVER from its own catalog and configuration and from this user's own records (loaded through their own access); every number a chip may quote is here, and text a
 * third party wrote (a posting, a scholarship) is returned separately as DATA, to be wrapped as untrusted. Pure builders: the loaders are tested in page-facts-load.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildPageFacts, MAX_PAGE_DATA_CHARS, MAX_PAGE_FACTS_CHARS, type PageFactsInput } from "@/lib/farah/page-facts";
import { describeMatchConfidence } from "@/lib/match-tier";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { AUTO_APPLY_DAILY_SUBMIT_CAP, AUTO_APPLY_FREE_PER_WEEK, AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";
import { ACTIVATED_MEANING, referralCapSentence, referralRewardHeadline } from "@/lib/referrals/copy";

const build = (input: PageFactsInput) => buildPageFacts(input);
const EXPL = { matchedSkills: ["Excel", "Reporting"], missingSkills: ["SQL", "Tableau"], seniorityAlignment: "match", screenableTagTotal: 9 };

describe("jobs: every match number is the scorer's", () => {
  const thisJob = { score: 83, explanation: EXPL };
  const out = build({ kind: "jobs", thisJob, top: [{ score: 94, explanation: EXPL, title: "Data Analyst", companyName: "Acme" }, { score: 88, explanation: EXPL, title: "BI Lead", companyName: "Globex" }] });
  it("this job's number and label are describeMatchConfidence's, not a copy", () => {
    const d = describeMatchConfidence(83, EXPL);
    expect(out.facts).toContain(`This job: ${d.displayScore}%`);
    expect(out.facts).toContain(d.label!);
  });
  it("each top match carries its own scorer figure, in rank order", () => {
    const a = describeMatchConfidence(94, EXPL), b = describeMatchConfidence(88, EXPL);
    expect(out.facts.indexOf(`Match 1: ${a.displayScore}%`)).toBeGreaterThan(-1);
    expect(out.facts.indexOf(`Match 2: ${b.displayScore}%`)).toBeGreaterThan(out.facts.indexOf("Match 1"));
  });
  it("titles, companies and skill names are third-party text: they are in the DATA, not the facts", () => {
    expect(out.data).toContain("Data Analyst");
    expect(out.data).toContain("SQL");
    for (const word of ["Data Analyst", "Acme", "Tableau"]) expect(out.facts).not.toContain(word);
  });
  it("the data holds no percentage, so there is no second number to prefer", () => expect(out.data ?? "").not.toMatch(/\d+\s*%/));
  it("a job with no score yet says so instead of a number", () => {
    const none = build({ kind: "jobs", thisJob: null, top: [] });
    expect(none.facts).toContain("This job: no score yet");
    expect(none.facts).not.toMatch(/\d+%/);
  });
  it("no top matches: says so, and the data block is absent", () => {
    const none = build({ kind: "jobs", top: [] });
    expect(none.facts).toContain("no top matches yet");
    expect(none.data).toBeUndefined();
  });
});

describe("scholarships: prices from the price list, only open listings", () => {
  const open = [{ programName: "Chevening", provider: "UK Government", deadline: "2026-11-05" }, { programName: "DAAD", provider: "DAAD", deadline: "2026-12-01" }];
  const out = build({ kind: "scholarships", open, detailText: undefined, detailOpen: undefined });
  it("the eligibility check (4) and the statement draft (16) are priced from CREDIT_COSTS", () => {
    expect(out.facts).toContain(`Eligibility check: ${CREDIT_COSTS.scholarshipEligibilityCheck} credits`);
    expect(out.facts).toContain(`Statement draft: ${CREDIT_COSTS.scholarshipSopDraft} credits`);
  });
  it("the listed scholarships are the open ones given, in order (soonest first), as data", () => {
    expect(out.data!.indexOf("Chevening")).toBeLessThan(out.data!.indexOf("DAAD"));
    expect(out.facts).toContain("2 open scholarships");
    expect(out.facts).not.toContain("Chevening");
  });
  it("no open scholarships: says so plainly", () => expect(build({ kind: "scholarships", open: [] }).facts).toContain("no open scholarships"));
  it("a scholarship being looked at: its stated terms are data, and its state (open or closed) is a fact", () => {
    const d = build({ kind: "scholarships", open, detailText: "Programme: Chevening\nFunding: full", detailOpen: false });
    expect(d.data).toContain("Programme: Chevening");
    expect(d.facts).toContain("This scholarship is closed");
    expect(build({ kind: "scholarships", open, detailText: "x", detailOpen: true }).facts).toContain("This scholarship is open");
  });
});

describe("resume builder and tailor: the action prices, from the price list", () => {
  it("resume builder: the bullet rewrite price and the Pass note; the roles are data", () => {
    const out = build({ kind: "resume-builder", topRoles: [{ title: "Data Analyst", companyName: "Acme" }] });
    expect(out.facts).toContain(`Bullet rewrite: ${CREDIT_COSTS.bulletRewrite} credits`);
    expect(out.facts).toMatch(/active Pass/);
    expect(out.data).toContain("Data Analyst");
    expect(out.facts).not.toContain("Data Analyst");
  });
  it("tailor: the tailoring run and the cover letter prices", () => {
    const out = build({ kind: "tailor" });
    expect(out.facts).toContain(`Tailor a resume: ${CREDIT_COSTS.tailoringRun} credits`);
    expect(out.facts).toContain(`Cover letter: ${CREDIT_COSTS.coverLetterRun} credits`);
    expect(out.facts).toMatch(/active Pass/);
  });
});

describe("tracker: only what is in the tracker", () => {
  const rows = [{ title: "Data Analyst", companyName: "Acme", stage: "applied", daysSinceChange: 9 }, { title: "BI Lead", companyName: "Globex", stage: "interviewing", daysSinceChange: 2 }];
  it("the count is a fact; the applications themselves are data", () => {
    const out = build({ kind: "tracker", applications: rows });
    expect(out.facts).toContain("The tracker holds 2 applications");
    expect(out.data).toContain("Data Analyst at Acme");
    expect(out.data).toContain("BI Lead at Globex");
    expect(out.facts).not.toContain("Acme");
  });
  it("an empty tracker says so, with no data block", () => {
    const out = build({ kind: "tracker", applications: [] });
    expect(out.facts).toContain("The tracker is empty");
    expect(out.data).toBeUndefined();
  });
  it("one application being worded about: it is in the data, flagged as the one in question", () => {
    const out = build({ kind: "tracker", applications: rows, focus: rows[1] });
    expect(out.data).toContain("The application in question: BI Lead at Globex");
  });
});

describe("Auto-Apply: the allowance is configuration and this user's own count", () => {
  const out = build({ kind: "auto-apply", quota: { submittedLast7d: 2, freeRemaining: 3, dailyRemaining: 4, nextSubmissionCostsCredits: false, nextSubmissionCovered: false } });
  it("the weekly allowance, the daily cap and the minimum score are the configured numbers", () => {
    expect(out.facts).toContain(`${AUTO_APPLY_FREE_PER_WEEK} confirmed applications a week`);
    expect(out.facts).toContain(`${AUTO_APPLY_DAILY_SUBMIT_CAP} a day`);
    expect(out.facts).toContain(`${AUTO_APPLY_MIN_SCORE}%`);
  });
  it("this user's own count: used and free left, as the quota function reported them", () => {
    expect(out.facts).toContain("Used in the last 7 days: 2");
    expect(out.facts).toContain("Free runs left: 3");
  });
  it("what the next one costs once the free runs are used, from the price list", () => expect(out.facts).toContain(`${CREDIT_COSTS.autoApplySubmission} credits`));
  it("a Pass that covers the next one is said, not a price", () => {
    const covered = build({ kind: "auto-apply", quota: { submittedLast7d: 5, freeRemaining: 0, dailyRemaining: 2, nextSubmissionCostsCredits: true, nextSubmissionCovered: true } });
    expect(covered.facts).toContain("covered by an active Pass");
  });
  it("opening an external posting is free, and nothing is submitted without confirmation", () => {
    expect(out.facts).toContain("Opening an external posting is always free");
    expect(out.facts).toMatch(/nothing is submitted until you confirm/i);
  });
  it("the external hand-off is stated: Auto-Apply never submits to an external posting, it hands the user to the source site and marks it handed off (never 'applied'), at no cost", () => {
    expect(out.facts).toMatch(/never submits to an external posting/i);
    expect(out.facts).toMatch(/hands you off to the source site/i);
    expect(out.facts).toMatch(/marked handed off, never applied/i);
    expect(out.facts).toMatch(/costs nothing and does not count against the cap/i);
  });
});

describe("mentorship: no price, no availability", () => {
  const out = build({ kind: "mentorship" });
  it("says mentor sessions are paid directly (not with credits) and that each profile shows its own price and availability", () => {
    expect(out.facts).toContain("paid directly to the mentor, not with credits");
    expect(out.facts).toMatch(/each mentor's profile shows/i);
  });
  it("holds no amount and no availability of any mentor", () => {
    expect(out.facts).not.toMatch(/[₦$£€]|\d/);
    expect(out.facts).not.toMatch(/available (on|at|from|today|tomorrow)|slots/i);
  });
});

describe("Talent Directory review: levels and costs from the price list, nothing else (the owner's NAV-1 words)", () => {
  const out = build({ kind: "talent-directory" });
  it("both levels with their credit costs", () => {
    expect(out.facts).toContain(`${CREDIT_COSTS.talentDirectoryVerification} credits`);
    expect(out.facts).toContain(`${CREDIT_COSTS.talentDirectoryHumanReview} credits`);
  });
  it("no turnaround time and no promised benefit", () => expect(out.facts).not.toMatch(/\b(hours?|days?|weeks?|within|guarantee|will get you|boost your chances)\b/i));
  it("says 'review', not 'verification' or 'verified' (the old words)", () => expect(out.facts).not.toMatch(/verif/i));
});

describe("refer: the reward, the cap and the meaning of activated are the configuration's", () => {
  const out = build({ kind: "refer" });
  it("reward headline, cap sentence and the activation rule, verbatim from referrals/copy", () => {
    expect(out.facts).toContain(referralRewardHeadline());
    expect(out.facts).toContain(referralCapSentence());
    expect(out.facts).toContain(ACTIVATED_MEANING);
  });
  it("the reward arrives at activation, not at signup", () => expect(out.facts).toMatch(/Nothing is paid at signup|paid when .* activate/i));
});

describe("every facts block is plain, bounded, and cannot close its own block", () => {
  const inputs: PageFactsInput[] = [
    { kind: "jobs", thisJob: { score: 80, explanation: EXPL }, top: [{ score: 90, explanation: EXPL, title: "T", companyName: "C" }] },
    { kind: "scholarships", open: [{ programName: "P", provider: "Q", deadline: "2026-11-05" }] },
    { kind: "resume-builder", topRoles: [] }, { kind: "tailor" },
    { kind: "tracker", applications: [] }, { kind: "auto-apply", quota: { submittedLast7d: 0, freeRemaining: 5, dailyRemaining: 5, nextSubmissionCostsCredits: false, nextSubmissionCovered: false } },
    { kind: "mentorship" }, { kind: "talent-directory" }, { kind: "refer" },
  ];
  it.each(inputs.map((i) => [i.kind, i] as const))("%s", (_k, i) => {
    const { facts } = build(i);
    expect(facts).not.toMatch(/[<>]/);
    expect(facts.length).toBeLessThanOrEqual(MAX_PAGE_FACTS_CHARS);
    expect(facts.length).toBeGreaterThan(15);
  });
});

describe("a thin match shows the scorer's CAPPED figure, never the raw score", () => {
  it("with only one screenable tag the displayed figure is describeMatchConfidence's, and the raw 99 is not quoted", () => {
    const thin = { matchedSkills: ["Excel"], missingSkills: [], seniorityAlignment: "match", screenableTagTotal: 1 };
    const d = describeMatchConfidence(99, thin);
    expect(d.isThin).toBe(true);
    expect(d.displayScore).not.toBe(99);
    const out = buildPageFacts({ kind: "jobs", thisJob: { score: 99, explanation: thin }, top: [{ score: 99, explanation: thin, title: "T", companyName: "C" }] });
    expect(out.facts).toContain(`This job: ${d.displayScore}%`);
    expect(out.facts).toContain("thin match");
    expect(out.facts).not.toContain("99%");
  });
});

describe("a repricing moves every price in the facts (nothing is typed in)", () => {
  it("with the price list changed, each page's facts say the new numbers", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/credits/costs", async () => {
      const actual = await vi.importActual<typeof import("@/lib/credits/costs")>("@/lib/credits/costs");
      return { ...actual, CREDIT_COSTS: { ...actual.CREDIT_COSTS, scholarshipEligibilityCheck: 9, scholarshipSopDraft: 33, bulletRewrite: 5, tailoringRun: 77, coverLetterRun: 12, autoApplySubmission: 6, talentDirectoryVerification: 31, talentDirectoryHumanReview: 91 } };
    });
    const { buildPageFacts: b } = await import("@/lib/farah/page-facts");
    expect(b({ kind: "scholarships", open: [] }).facts).toContain("Eligibility check: 9 credits");
    expect(b({ kind: "scholarships", open: [] }).facts).toContain("Statement draft: 33 credits");
    expect(b({ kind: "resume-builder", topRoles: [] }).facts).toContain("Bullet rewrite: 5 credits");
    expect(b({ kind: "tailor" }).facts).toContain("Tailor a resume: 77 credits");
    expect(b({ kind: "tailor" }).facts).toContain("Cover letter: 12 credits");
    expect(b({ kind: "auto-apply", quota: { submittedLast7d: 5, freeRemaining: 0, dailyRemaining: 1, nextSubmissionCostsCredits: true, nextSubmissionCovered: false } }).facts).toContain("costs 6 credits");
    expect(b({ kind: "talent-directory" }).facts).toContain("31 credits");
    expect(b({ kind: "talent-directory" }).facts).toContain("91 credits");
    vi.doUnmock("@/lib/credits/costs");
    vi.resetModules();
  });
});

describe("a failed read is never an empty result", () => {
  it.each([
    ["jobs", { kind: "jobs", top: [], unavailable: true }, "match data"],
    ["scholarships", { kind: "scholarships", open: [], unavailable: true }, "scholarship list"],
    ["resume-builder", { kind: "resume-builder", topRoles: [], unavailable: true }, "matched roles"],
    ["tracker", { kind: "tracker", applications: [], unavailable: true }, "tracker"],
    ["auto-apply", { kind: "auto-apply", quota: null, unavailable: true }, "Auto-Apply count"],
  ] as const)("%s: says the data could not be loaded, and does not say there is none", (_k, input, what) => {
    const out = buildPageFacts(input as PageFactsInput);
    expect(out.facts).toContain(`This user's ${what} could not be loaded just now. Say so plainly and do not guess.`);
    expect(out.facts).not.toMatch(/is empty|no top matches|no open scholarships|Free runs left|holds \d/);
    expect(out.data).toBeUndefined();
  });
  it("prices still stand when only the user's data failed", () => {
    expect(buildPageFacts({ kind: "scholarships", open: [], unavailable: true }).facts).toContain("Eligibility check: 4 credits");
    expect(buildPageFacts({ kind: "resume-builder", topRoles: [], unavailable: true }).facts).toContain("Bullet rewrite: 2 credits");
  });
});

describe("the data block has a ceiling", () => {
  it("a long tracker or a long scholarship text is cut at the cap, so a request cannot grow without bound", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ title: `Role ${i} ${"x".repeat(80)}`, companyName: "Acme", stage: "applied", daysSinceChange: i }));
    expect(buildPageFacts({ kind: "tracker", applications: rows }).data!.length).toBeLessThanOrEqual(MAX_PAGE_DATA_CHARS);
    expect(buildPageFacts({ kind: "scholarships", open: [], detailText: "y".repeat(50_000), detailOpen: true }).data!.length).toBeLessThanOrEqual(MAX_PAGE_DATA_CHARS);
  });
});
