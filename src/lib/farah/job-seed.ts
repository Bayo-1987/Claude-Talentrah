/**
 * "Ask Farah" per job (send-100) — the seed a job card's button hands to the
 * docked Farah panel.
 *
 * WHY A WINDOW EVENT, NOT REACT CONTEXT. `scroll-to-panel.ts` (the existing
 * "Ask Farah" button on the mobile tab) already faced this exact shape of
 * problem — a click deep in the job feed needs to reach the docked panel, a
 * SIBLING under (app)/layout.tsx, which is a Server Component and cannot
 * itself hold client state. Its own header explains why it chose a DOM
 * primitive over lifting a ref/context into that layout: doing so "purely so
 * two buttons can point at a third element that is already on the page" is
 * the bigger change for a smaller problem. This needs to carry DATA
 * (jobId/title/company), not just a pointer, but the same reasoning holds —
 * a browser CustomEvent needs no provider wrapped around the layout, no new
 * dependency (this repo has zero React Context/state-library usage anywhere,
 * confirmed by grep before choosing this), and cannot desynchronise from
 * what is actually rendered, the same property scroll-to-panel.ts's approach
 * has.
 *
 * `FarahPanel` listens for this event once on mount; `FarahJobMenu`'s "Ask
 * Farah" button dispatches it. Both are already "use client" leaves under
 * the same layout, so this is exactly the sibling-to-sibling case the event
 * exists for.
 */

export interface FarahJobSeed {
  jobId: string;
  jobTitle: string;
  companyName: string;
}

/** Logged alongside the three existing quick-action entry points (0124). */
export const JOB_FIT_ENTRY_POINT = "job_fit";

export interface JobSeedChatStarter {
  /** Sent to the panel as `quickAction` — always JOB_FIT_ENTRY_POINT, see its own doc comment. */
  key: string;
  label: string;
}

/**
 * The two starters that send a real, gated chat message. Mirrors jobright's
 * "Ask Orion" prompts, mapped onto what Talentrah actually has — see
 * send-100's own spec for the full mapping and why the other two of
 * jobright's four became links instead (JOB_SEED_LINKS below).
 */
export const JOB_SEED_CHAT_STARTERS: JobSeedChatStarter[] = [
  { key: JOB_FIT_ENTRY_POINT, label: "Why is this a good fit for me?" },
  { key: JOB_FIT_ENTRY_POINT, label: "What resume tips do you have for this role?" },
];

/** The templated, free, instant opener — never sent to the LLM, never persisted. */
export function jobSeedOpener(seed: FarahJobSeed): string {
  return `I can help with the ${seed.jobTitle} role at ${seed.companyName}. Want to know if you're a fit, or how to make your resume stronger for it?`;
}

/** `/tailor?jobId=...` — Talentrah's real generation flow, unchanged (send-100 leaves Land alone). */
export function tailorHref(jobId: string): string {
  return `/tailor?jobId=${jobId}`;
}

/**
 * `/tailor?jobId=...&coverLetter=1` — the fourth Orion slot ("Connections
 * for a referral") has no Talentrah equivalent (no professional-network
 * feature, no data to answer it), so this substitutes Talentrah's own second
 * real generation action rather than fabricating the fourth one or dropping
 * it silently. Same query-param contract `/tailor`'s own page already reads
 * (`coverLetter === "1" || coverLetter === "true"`).
 */
export function coverLetterHref(jobId: string): string {
  return `/tailor?jobId=${jobId}&coverLetter=1`;
}

const FARAH_JOB_SEED_EVENT = "farah:job-seed";

/** Fired by a job card's "Ask Farah" button. Purely client-side — see the file header. */
export function seedFarahForJob(seed: FarahJobSeed): void {
  window.dispatchEvent(new CustomEvent<FarahJobSeed>(FARAH_JOB_SEED_EVENT, { detail: seed }));
}

/** Subscribed once by FarahPanel on mount. Returns the unsubscribe function. */
export function onFarahJobSeed(handler: (seed: FarahJobSeed) => void): () => void {
  function listener(e: Event): void {
    handler((e as CustomEvent<FarahJobSeed>).detail);
  }
  window.addEventListener(FARAH_JOB_SEED_EVENT, listener);
  return () => window.removeEventListener(FARAH_JOB_SEED_EVENT, listener);
}
