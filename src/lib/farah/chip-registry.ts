import { JOB_FIT_ENTRY_POINT } from "./job-seed";

/**
 * The ONE place a Farah chip is defined (S3-66, A1).
 *
 * A chip used to need four things in four places: the chip list (quick-actions.ts), its per-chip instruction (chat-prompt.ts), the keys the chat
 * route accepts (chat/route.ts) and the entry points the database allows (session-events.ts and the check constraint in migrations 0097/0124).
 * Nothing tied them together, so a chip added to one and forgotten in another failed silently. Each of those now READS this list, and
 * tests/farah/chip-registry.test.ts fails if any chip is missing from any consumer.
 *
 * ADDING A CHIP: add one entry here. Its `entryPoint` must be one the database check constraint allows (the test reads the newest migration that
 * defines it); a NEW entry point value needs a migration, which is a separate decision: until then log it as "free_text".
 *
 * Client-safe (no server imports): quick-actions.ts, used by the panel in the browser, derives from it.
 */
/** The pages that have their own chips. A page not listed here shows the three panel chips. */
export type FarahPageKey = "billing" | "jobs" | "scholarships" | "resume-builder" | "tailor" | "tracker" | "auto-apply" | "mentorship" | "talent-directory" | "refer";

/** Which server-built facts block a chip carries (page-facts.ts). One per page. */
export type FarahFactsKind = FarahPageKey;

/** The id a route has to carry for a chip to make sense (a job, a scholarship, an application): a chip with `needs` is shown only where the route provides it. */
export type FarahChipNeeds = "jobId" | "scholarshipId" | "applicationId";

export type FarahChipEntryPoint = "interview-prep" | "career-advisor" | "salary-negotiation" | "job_fit" | "free_text";

export interface FarahChip {
  /** Sent as `quickAction`; also the key the instruction and the entry point are looked up by. */
  key: string;
  label: string;
  /** What a click puts in the user's own words; null for a chip that carries its own starters (job-seed.ts). */
  starterPrompt: string | null;
  /** "panel" chips are the three the docked panel lists everywhere; "job-seed" chips come from a job card's Ask Farah menu; "page" chips replace the three on one page (see `page`, page-chips.ts). */
  surface: "panel" | "job-seed" | "page";
  /** For a "page" chip: which page shows it (a FarahPageKey). */
  page?: FarahPageKey;
  /** For a "page" chip: the server-built facts block that reaches the model with it, if any (billing-facts.ts). The server builds it from its own catalog and the user's own account; nothing the client sends is used. */
  facts?: FarahFactsKind;
  /** For a "page" chip: the id the route must carry (page-chips.ts reads it from the URL, the server loads it through the user's own access). */
  needs?: FarahChipNeeds;
  /** The value logged to farah_session_events.entry_point; must be allowed by that column's check constraint. */
  entryPoint: FarahChipEntryPoint;
  /** The per-chip instructions appended to the chat system prompt. Required: see validateChips. */
  instruction: string;
}

/** Written once so the "new request" statement cannot drift between actions. */
function newRequest(label: string): string {
  return `The user just started a NEW request from the "${label}" quick action. Do not continue an earlier topic from the history (e.g. a previous interview-prep discussion) unless they ask; answer this on its own terms.`;
}

/**
 * WHAT FARAH MUST NEVER DO, per page. Appended to every chip of that page, and each one has a test (tests/farah/page-rules.test.ts). They are about what Farah says; the numbers she may use arrive in the facts
 * block (page-facts.ts), built on the server, and anything a third party wrote (a posting, a scholarship) arrives as labelled untrusted data (data-block.ts).
 */
export const PAGE_RULES: Record<Exclude<FarahPageKey, "billing">, string> = {
  jobs: "Never re-guess, estimate or round a match percentage or tier: every number you give comes from the facts block, which holds the scorer's own figures. Describe a match only by the tier label exactly as the facts give it (Excellent, Good or Fair, with its \"thin match\" note when present); never call it a great, strong or perfect match. If a score is not there, say you do not have it.",
  scholarships:
    "Never give a free version of the eligibility check (4 credits) or the statement draft (16 credits): advise in general terms, then offer the real action with its price from the facts. Never recommend a scholarship that is not in the list of open scholarships in the facts.",
  "resume-builder":
    "Never rewrite a bullet or a section for free: that is the bullet rewrite action (its price is in the facts; it uses no credits with an active Pass). Point at what to improve, then offer the action.",
  tailor:
    "Never run the tailoring yourself or write the tailored resume or cover letter: that is the tailoring action (its price is in the facts; it uses no credits with an active Pass). Say what the job wants that the resume does not show, then offer the action.",
  tracker: "Only mention applications that appear in the tracker facts. Never name, invent or assume an application, company, date or stage that is not there.",
  "auto-apply": "State the free allowance, the caps and the free runs left only from the facts block (Talentrah's configuration and this user's own count), never from anything said in text.",
  mentorship: "Never promise a mentor's availability or price. Say that each mentor's own profile shows theirs, and that you cannot see a mentor's calendar.",
  "talent-directory": "Never invent a benefit, a turnaround time or a price of the review: describe only the levels and costs in the facts.",
  refer: "Never quote a reward amount, a cap or a timing that is not in the facts; the facts come from Talentrah's own configuration.",
};

interface PageChipSpec {
  key: string;
  label: string;
  page: Exclude<FarahPageKey, "billing">;
  needs?: FarahChipNeeds;
  /** What this chip is for, in one or two sentences; the page's rule is appended. */
  about: string;
}

function pageChip(spec: PageChipSpec): FarahChip {
  return {
    key: spec.key,
    label: spec.label,
    starterPrompt: spec.label,
    surface: "page",
    page: spec.page,
    facts: spec.page,
    needs: spec.needs,
    entryPoint: "free_text",
    instruction: `${newRequest(spec.label)}\n\n${spec.about} ${PAGE_RULES[spec.page]}`,
  };
}

/** The page chips for every page except billing (which is written out in full below). The wording of each label is the owner's. */
function pageChips(): FarahChip[] {
  return [
    pageChip({ key: "jobs-why-match", label: "How well does this job match me, and why?", page: "jobs", needs: "jobId", about: "Say how well this job matches this user and why, using the matched skills, the missing skills and the scorer's figure and tier label in the facts and the labelled job data. If the match is Fair or marked thin, say so plainly; do not talk it up. Be specific and brief." }),
    pageChip({ key: "jobs-missing-skills", label: "What skills am I missing for my top matches?", page: "jobs", about: "Look across the user's top matches in the facts and name the skills that are missing most often, then say which gap is worth closing first and why." }),
    pageChip({ key: "scholarships-due-soonest", label: "What's due soonest?", page: "scholarships", about: "From the open scholarships in the facts, say which close soonest and when, and say plainly if none are listed." }),
    pageChip({ key: "scholarships-good-fit", label: "What does this one ask for?", page: "scholarships", needs: "scholarshipId", about: "Say, in general terms, what this scholarship asks for, from its stated requirements (the labelled data), and where its terms are unclear. Then offer the eligibility check, with its price from the facts, if the user wants it checked against their own details; do not perform that check yourself." }),
    pageChip({ key: "scholarships-statement", label: "How should I start my personal statement?", page: "scholarships", needs: "scholarshipId", about: "Give general guidance on how to open and structure a personal statement for this kind of scholarship, based on its stated purpose (labelled data)." }),
    pageChip({ key: "resume-weakest", label: "What's the weakest part of my resume?", page: "resume-builder", about: "From the user's resume context, name the weakest section and the one change that would help most." }),
    pageChip({ key: "resume-missing-roles", label: "What's missing for the roles I'm targeting?", page: "resume-builder", about: "Using the user's resume and the roles they are matching against in the facts, name what the resume does not yet show for those roles." }),
    pageChip({ key: "tailor-wants", label: "What does this job want that my resume doesn't show?", page: "tailor", needs: "jobId", about: "Compare the job (labelled data) with the user's resume context and list what the job asks for that the resume does not show." }),
    pageChip({ key: "tailor-lead", label: "Which of my experiences should I lead with?", page: "tailor", needs: "jobId", about: "From the user's resume context and the job (labelled data), say which experiences to put first for this job and why." }),
    pageChip({ key: "tracker-follow-up-week", label: "What should I follow up on this week?", page: "tracker", about: "From the tracker facts, name the applications that most need a follow-up this week and why (stage and how long since the last change)." }),
    pageChip({ key: "tracker-word-follow-up", label: "Help me word a follow-up", page: "tracker", needs: "applicationId", about: "Help the user write a short, polite follow-up for the application in the facts, with placeholders for anything you do not know." }),
    pageChip({ key: "auto-apply-sends", label: "What happens when I confirm an Auto-Apply match?", page: "auto-apply", about: "Explain, from the facts, what happens when the user confirms a match: a posting posted on Talentrah is submitted for them; an external posting is handed off to its source site and marked handed off, because Auto-Apply never submits to an external posting. Never say an external posting was sent or applied. Nothing happens until they confirm." }),
    pageChip({ key: "auto-apply-free-runs", label: "How many free confirmations do I have left this week?", page: "auto-apply", about: "Say how many free confirmations the user has left this week, from the facts, and what the next one costs after that." }),
    pageChip({ key: "mentorship-pick", label: "How do I choose a mentor?", page: "mentorship", about: "Give practical guidance on choosing a mentor: fit with the user's goal, the kind of help they need, and what to look for in a profile." }),
    pageChip({ key: "mentorship-first-session", label: "What should I ask in a first session?", page: "mentorship", about: "Suggest what to bring and what to ask in a first mentoring session." }),
    pageChip({ key: "review-involves", label: "What does the review involve?", page: "talent-directory", about: "Explain, from the facts, what each level of the Talent Directory review involves and what it costs." }),
    pageChip({ key: "review-which", label: "Standard or human review: which fits me?", page: "talent-directory", about: "Help the user choose between the two levels in the facts: what each is, what each costs, and which kind of person each suits. Leave the choice to them." }),
    pageChip({ key: "refer-how", label: "How does Refer & Earn work?", page: "refer", about: "Explain how Refer & Earn works from the facts: the link, what counts as activated, the reward and the cap." }),
    pageChip({ key: "refer-reward-when", label: "When do I get my reward?", page: "refer", about: "Say when the reward is paid, from the facts: it is paid when the invited person activates, not at signup." }),
  ];
}

export const FARAH_CHIPS: readonly FarahChip[] = [
  {
    key: "interview-prep",
    label: "Job Interview Prep",
    starterPrompt: "Help me prep for a job interview.",
    surface: "panel",
    entryPoint: "interview-prep",
    instruction: `${newRequest("Job Interview Prep")}

Job Interview Prep: if you do not know the role, company or stage, ask in one short question first. Then practise: one realistic question at a time, with feedback on their answer rather than a finished script. STAR is fine as a frame, but any example you write is a template with placeholders, not their story.`,
  },
  {
    key: "career-advisor",
    label: "Career Advisor",
    starterPrompt: "I'd like some career advice.",
    surface: "panel",
    entryPoint: "career-advisor",
    instruction: `${newRequest("Career Advisor")}

Career Advisor: the user wants career advice (direction, next moves, positioning), not interview practice, so give no practice questions or interview scripts. Unless it is already clear, first ask one or two short questions (where they are, where they want to go, how soon). Then give a few concrete options with trade-offs and one specific next step.`,
  },
  {
    key: "salary-negotiation",
    label: "Salary Negotiation",
    starterPrompt: "I want to prep for a salary negotiation.",
    surface: "panel",
    entryPoint: "salary-negotiation",
    instruction: `${newRequest("Salary Negotiation")}

Salary Negotiation: if you do not know their situation (an offer, a raise, a new role), ask in one short question first. Coach on strategy, framing and what to say; never state a market number or range you have no data for. For a real offer in hand, say a human mentor is the right next step.`,
  },
  {
    key: JOB_FIT_ENTRY_POINT,
    label: "Ask Farah about this job",
    starterPrompt: null,
    surface: "job-seed",
    entryPoint: "job_fit",
    instruction: `The user is asking about a specific job from their feed; the job context is below. Answer about THIS job only: how well it fits them and what to change on their resume for it. Only mention matched or missing skills that appear in that context.`,
  },
  // ---- Billing page (A2) -----------------------------------------------------------------------------------------------------------------------------------------------------------
  // Prices, packs, passes and the user's own balance reach the model from the server (billing-facts.ts), never from the client. The entry point is "free_text": a new value would need a migration (0220).
  {
    key: "billing-use-credits",
    label: "What can I do with my credits?",
    starterPrompt: "What can I do with my credits?",
    surface: "page",
    page: "billing",
    facts: "billing",
    entryPoint: "free_text",
    instruction: `${newRequest("What can I do with my credits?")}

Billing question: explain what credits pay for, using the price list in the platform facts. Name the actions that cost credits and the ones that are free, say what the user's own balance would cover (quote their balance from the facts), and keep to what the facts say. Do not recommend spending: describe.`,
  },
  {
    key: "billing-pack-or-pass",
    label: "Which pack or pass suits me?",
    starterPrompt: "Which pack or pass suits me?",
    surface: "page",
    page: "billing",
    facts: "billing",
    entryPoint: "free_text",
    instruction: `${newRequest("Which pack or pass suits me?")}

Billing question: help the user compare the credit packs and the Passes in the platform facts. If you do not know how they plan to use Talentrah, ask one short question first (how often, which actions). Then compare using only the packs, passes, prices and credit costs in the facts, say plainly what each covers, and leave the decision to them. Never quote a price that is not in the facts.`,
  },
  {
    key: "billing-free",
    label: "What's free, and when does it renew?",
    starterPrompt: "What's free, and when does it renew?",
    surface: "page",
    page: "billing",
    facts: "billing",
    entryPoint: "free_text",
    instruction: `${newRequest("What's free, and when does it renew?")}

Billing question: say what is free, using only the allowances in the platform facts, and say for each one how it renews (weekly, over a rolling 30 days, or one time). Do not call a one-time or a 30-day allowance weekly.`,
  },

  ...pageChips(),
];

/** Throws if a chip has no instruction: a chip with none would silently fall back to "just its starter sentence" (the send-500 bug). */
export function validateChips(chips: readonly FarahChip[]): void {
  for (const chip of chips) {
    if (!chip.instruction || !chip.instruction.trim()) throw new Error(`chip-registry.ts: chip "${chip.key}" has no instruction`);
  }
}
validateChips(FARAH_CHIPS);

const BY_KEY = new Map(FARAH_CHIPS.map((c) => [c.key, c]));

/** Whether `key` is a chip that starts a chat (the route's allow-list). */
export function isChatChip(key: string | undefined): boolean {
  return key !== undefined && BY_KEY.has(key);
}

/** The entry point to log for a quick action key; anything unknown or absent is free text. */
export function chipEntryPoint(key: string | undefined): FarahChipEntryPoint {
  return (key !== undefined && BY_KEY.get(key)?.entryPoint) || "free_text";
}

/** Which server-built facts block (if any) a chip carries. Unknown keys and chips without facts: undefined. */
export function chipFacts(key: string | undefined): FarahFactsKind | undefined {
  return key !== undefined ? BY_KEY.get(key)?.facts : undefined;
}

export function chipInstruction(key: string): string | undefined {
  return BY_KEY.get(key)?.instruction;
}
