/**
 * Page-aware chips, table-driven. Every LISTED route gets exactly its chips and its one-line opening line (and the ids the route carries); every route NOT listed gets exactly today's three chips, in today's order,
 * with today's starter prompts (written out here as literals, so a registry edit cannot change them by accident) and no opening-line change.
 *
 * A chip that needs an id (a job, a scholarship, an application) is shown only on a route that carries one. Employer pages render no panel at all, so they are not rows here.
 */
import { describe, expect, it } from "vitest";
import { farahPageKeyForPath, pageContextForPath, panelChipsForPath } from "@/lib/farah/page-chips";

const ID = "123e4567-e89b-42d3-a456-426614174000";

const TODAYS_THREE = [
  { key: "interview-prep", label: "Job Interview Prep", starterPrompt: "Help me prep for a job interview." },
  { key: "career-advisor", label: "Career Advisor", starterPrompt: "I'd like some career advice." },
  { key: "salary-negotiation", label: "Salary Negotiation", starterPrompt: "I want to prep for a salary negotiation." },
];

interface Row { path: string; search?: string; page: string; chips: string[]; openingLine: string; ids?: Record<string, string> }

const BILLING = ["What can I do with my credits?", "Which pack or pass suits me?", "What's free, and when does it renew?"];
const SCHOLARSHIP_ALL = ["What's due soonest?", "What does this one ask for?", "How should I start my personal statement?"];
const JOBS_ALL = ["How well does this job match me, and why?", "What skills am I missing for my top matches?"];
const OPEN = {
  billing: "Ask me what your credits can do, which pack or pass might suit you, or what's free.",
  jobs: "Looking at your matches? Ask me why a job fits, or what's missing.",
  scholarships: "Choosing a scholarship? I can help you pick one and plan your statement.",
  resume: "Working on your resume? I can point at what to improve.",
  tailor: "Pasted a job? I can tell you what it wants that your resume doesn't show yet.",
  tracker: "Keeping track of applications? I can tell you which ones are worth a follow-up.",
  autoApply: "Wondering what Auto-Apply will do with a match? Ask me. Nothing is applied until you confirm.",
  mentorship: "Thinking about a mentor? Ask me how to choose and what to bring.",
  verify: "Thinking about joining the Talent Directory? I can explain what the review involves.",
  refer: "Want to invite someone? I can explain how Refer & Earn works.",
};
const RESUME = ["What's the weakest part of my resume?", "What's missing for the roles I'm targeting?"];

const LISTED: Row[] = [
  { path: "/billing", page: "billing", chips: BILLING, openingLine: OPEN.billing },
  { path: "/jobs", page: "jobs", chips: [JOBS_ALL[1]], openingLine: OPEN.jobs },
  { path: `/jobs/${ID}`, page: "jobs", chips: JOBS_ALL, openingLine: OPEN.jobs, ids: { jobId: ID } },
  { path: "/scholarships", page: "scholarships", chips: [SCHOLARSHIP_ALL[0]], openingLine: OPEN.scholarships },
  { path: `/scholarships/${ID}`, page: "scholarships", chips: SCHOLARSHIP_ALL, openingLine: OPEN.scholarships, ids: { scholarshipId: ID } },
  { path: "/resume-builder", page: "resume-builder", chips: RESUME, openingLine: OPEN.resume },
  { path: "/resume-builder/edit", search: `?resumeId=${ID}`, page: "resume-builder", chips: RESUME, openingLine: OPEN.resume },
  { path: "/tailor", search: `?jobId=${ID}`, page: "tailor", chips: ["What does this job want that my resume doesn't show?", "Which of my experiences should I lead with?"], openingLine: OPEN.tailor, ids: { jobId: ID } },
  { path: "/tracker", page: "tracker", chips: ["What should I follow up on this week?"], openingLine: OPEN.tracker },
  { path: `/tracker/${ID}/sent`, page: "tracker", chips: ["What should I follow up on this week?", "Help me word a follow-up"], openingLine: OPEN.tracker, ids: { applicationId: ID } },
  { path: "/auto-apply", page: "auto-apply", chips: ["What happens when I confirm an Auto-Apply match?", "How many free confirmations do I have left this week?"], openingLine: OPEN.autoApply },
  { path: "/mentorship", page: "mentorship", chips: ["How do I choose a mentor?", "What should I ask in a first session?"], openingLine: OPEN.mentorship },
  { path: `/mentorship/${ID}`, page: "mentorship", chips: ["How do I choose a mentor?", "What should I ask in a first session?"], openingLine: OPEN.mentorship },
  { path: "/talent-directory/verify", page: "talent-directory", chips: ["What does the review involve?", "Standard or human review: which fits me?"], openingLine: OPEN.verify },
  { path: "/refer", page: "refer", chips: ["How does Refer & Earn work?", "When do I get my reward?"], openingLine: OPEN.refer },
];

/** [path, search]: routes with no row above, including near misses (a sibling or child of a listed route, a bad id, a missing query). */
const UNLISTED: Array<[string, string?]> = [
  ["/"], ["/jobs/remote"], ["/jobs/remote/nigeria"], ["/jobs/in/lagos"], ["/jobs/not-a-uuid"], [`/jobs/${ID}/extra`],
  ["/scholarships/degree/masters"], ["/scholarships/fully-funded"], ["/scholarships/apply-now"], ["/scholarships/not-a-uuid"],
  ["/tailor"], ["/tailor", "?jobId="], ["/tailor", "?jobId=not-a-uuid"], ["/tailor", `?other=${ID}`], ["/tailor/extra", `?jobId=${ID}`],
  ["/resume-builder/new"], ["/resume-builder/edit/extra"],
  [`/tracker/${ID}`], ["/tracker/not-a-uuid/sent"], [`/tracker/${ID}/sent/extra`],
  ["/auto-apply/extra"], ["/mentorship/sessions"], ["/mentorship/apply"], ["/mentorship/reviews"],
  ["/talent-directory"], ["/talent-directory/verify/extra"], ["/refer/extra"], ["/referral"],
  ["/billing/callback"], ["/billingx"], ["/billing-history"], ["/account/billing"],
  ["/settings"], ["/feedback"], ["/dashboard"], ["/onboarding"], ["/employer/jobs"], ["/employer"], ["/blog"], ["/pricing"],
];

describe("listed routes", () => {
  it.each(LISTED)("$path$search gets exactly its chips and its opening line", ({ path, search, page, chips, openingLine, ids }) => {
    expect(farahPageKeyForPath(path, search)).toBe(page);
    const got = panelChipsForPath(path, search);
    expect(got.chips.map((c) => c.label)).toEqual(chips);
    expect(got.chips.map((c) => c.starterPrompt)).toEqual(chips); // a click puts the label in the user's own words
    expect(got.openingLine).toBe(openingLine);
    expect(pageContextForPath(path, search)).toEqual(ids ?? {});
  });

  it("a trailing slash or a fragment does not change the answer", () => {
    expect(farahPageKeyForPath("/billing/")).toBe("billing");
    expect(farahPageKeyForPath("/refer/")).toBe("refer");
    expect(farahPageKeyForPath("/billing#top")).toBe("billing");
  });

  it("every chip has its own key and none is one of today's three", () => {
    const seen = new Set<string>();
    for (const row of LISTED) for (const c of panelChipsForPath(row.path, row.search).chips) {
      expect(TODAYS_THREE.map((t) => t.key)).not.toContain(c.key);
      seen.add(c.key);
    }
    expect(seen.size).toBe(22); // 3 billing + 2 jobs + 3 scholarships + 2 resume + 2 tailor + 2 tracker + 2 auto-apply + 2 mentorship + 2 verification + 2 refer
  });

  it("a chip that needs an id appears only where the route carries one", () => {
    const ids = new Set(LISTED.filter((r) => r.ids).map((r) => r.path));
    for (const row of LISTED) for (const c of panelChipsForPath(row.path, row.search).chips) {
      if ("needs" in c && c.needs) expect(ids.has(row.path), `${c.key} on ${row.path}`).toBe(true);
    }
  });
});

describe("every route that is not listed gets exactly today's three chips", () => {
  it.each(UNLISTED)("%s%s", (path, search) => {
    expect(farahPageKeyForPath(path, search)).toBeNull();
    const got = panelChipsForPath(path, search);
    expect(got.chips.map(({ key, label, starterPrompt }) => ({ key, label, starterPrompt }))).toEqual(TODAYS_THREE);
    expect(got.openingLine).toBeNull();
    expect(pageContextForPath(path, search)).toEqual({});
  });

  it("no route given (before the path is known) is the same as an unlisted one", () => {
    for (const none of [null, undefined, ""]) {
      expect(panelChipsForPath(none as never).chips.map((c) => c.key)).toEqual(TODAYS_THREE.map((t) => t.key));
      expect(panelChipsForPath(none as never).openingLine).toBeNull();
    }
  });
});

describe("the query string is read only where a route needs it", () => {
  it("a search string on a route that does not use one changes nothing", () => {
    expect(panelChipsForPath("/billing", `?jobId=${ID}`).chips.map((c) => c.label)).toEqual(BILLING);
    expect(pageContextForPath("/billing", `?jobId=${ID}`)).toEqual({});
  });
  it("accepts a URLSearchParams as well as a string", () => {
    expect(pageContextForPath("/tailor", new URLSearchParams({ jobId: ID }))).toEqual({ jobId: ID });
  });
});
