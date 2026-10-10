import { FARAH_MESSAGE_DRAFT_NGN } from "@/lib/billing/catalog";
import { BODY_MAX, SUBJECT_MAX, TEMPLATE_LABELS, type MessageKind } from "./constants";
import { normalizeMessage } from "./normalize";

export const NOTES_MAX = 2000;

export type DraftMode = "draft" | "refine";

/** The ONLY things the model ever sees. No email, phone, resume, score, screening answers or assessment: the job's title, the organisation's name, two first names and what the employer wrote. */
export interface DraftPromptInput {
  kind: MessageKind;
  mode: DraftMode;
  jobTitle: string;
  orgName: string;
  candidateFirstName: string | null;
  senderFirstName: string | null;
  notes: string;
  currentSubject: string;
  currentBody: string;
}

export interface DraftInput extends DraftPromptInput {
  organizationId: string;
  userId: string;
}

export interface DraftDeps {
  /** Does the organisation have Premium right now (organization_premium, read with the service role)? */
  hasPremium(organizationId: string): Promise<boolean>;
  /** debit_ad_wallet. `failed` = the call itself errored (not the same as "not enough balance"). */
  debit(p: { organizationId: string; userId: string; amountNgn: number }): Promise<{ ok: boolean; failed: boolean }>;
  /** credit_ad_wallet with reason 'reversal'. */
  credit(p: { organizationId: string; userId: string; amountNgn: number }): Promise<{ failed: boolean }>;
  generate(input: DraftPromptInput): Promise<{ subject: string; body: string }>;
}

export type DraftResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; kind: "premium_required" | "insufficient_balance" | "generation_error" | "invalid"; error: string };

const MONEY = /(?:₦|ngn\s?|\$|£|€|usd\s?|gbp\s?)\s?\d[\d,.]*/gi;
const WORDS = /\b(?:salary|compensation|remuneration|stipend|bonus|equity|job offer|offer you|make you an offer|extend an offer|guarantee[ds]?|you(?:'ve| have) got the job|you(?:'re| are) hired|you will be hired)\b/gi;
const CLOCK = /\b(?:\d{1,2}[:.]\d{2}\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm))\b/gi;
const DATE = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;

/**
 * The model is told not to invent pay, dates, times, offers or guarantees; this is the check that does not rely on it obeying. A figure, a clock time, a date or a promise word that appears in the
 * draft but NOT in what the employer wrote themselves (their notes and their current text) is an invented promise: the draft is refused and the charge refunded. Returns what was found, or null.
 */
export function findInventedPromise(draft: string, employerWords: string): string | null {
  const source = employerWords.toLowerCase();
  for (const pattern of [MONEY, WORDS, CLOCK, DATE]) {
    for (const match of draft.matchAll(pattern)) {
      if (!source.includes(match[0].toLowerCase().trim())) return match[0].trim();
    }
  }
  return null;
}

/** The instruction text for one draft. Plain facts plus the rules; never anything about the candidate beyond their first name. */
export function buildDraftPrompt(input: DraftPromptInput): string {
  const lines = [
    `You are helping an employer write ONE short message to a job applicant, from the employer to the candidate. The employer will review and edit it and press Send themselves: you never send anything.`,
    ``,
    `Kind of message: ${input.kind === "custom" ? "a custom message" : TEMPLATE_LABELS[input.kind as keyof typeof TEMPLATE_LABELS] ?? input.kind}`,
    `Job: ${input.jobTitle}`,
    `Organisation: ${input.orgName}`,
    `Candidate's first name: ${input.candidateFirstName?.trim() || "(not known: greet them as \"there\")"}`,
    `Sender's first name: ${input.senderFirstName?.trim() || "(not known)"}`,
    ``,
    input.notes.trim() ? `The employer's notes (the facts you may use):\n${input.notes.trim()}` : `The employer gave no notes: keep it to a courteous, generic message.`,
  ];
  if (input.mode === "refine") {
    lines.push(``, `Improve this draft the employer wrote (keep its meaning and any facts in it; fix tone, clarity and length):`, `Subject: ${input.currentSubject.trim()}`, input.currentBody.trim());
  }
  lines.push(
    ``,
    `Rules:`,
    `- Do not invent anything: no dates, times, salary or pay, benefits, offers, deadlines, interview formats, names or reasons for a decision. Use only what the employer's notes (and their own draft) say.`,
    `- Do not promise or imply an outcome (hiring, an offer, a next step) unless the employer's notes say so.`,
    `- For "not moving forward", be courteous and brief and give NO reason.`,
    `- Plain text only, no markdown, no links. Warm, direct and professional. Under 180 words. Start with "Hi <first name>," and end with a sign-off from the sender and organisation.`,
    `- Return a subject line (one line) and the message body.`,
  );
  return lines.join("\n");
}

/**
 * "Draft/Refine with Farah" on Message candidate. Order, each step refusing before the next one costs anything: validate lengths, check Premium (free plans never reach the wallet or the model),
 * debit the ad wallet BEFORE generating, generate, check the draft (usable and no invented promise), and credit back with 'reversal' on ANY failure after the debit, exactly once. It returns text
 * for the employer to review: it has no way to send (there is no send dependency here), so Farah never contacts a candidate by herself.
 */
export async function runFarahMessageDraft(input: DraftInput, deps: DraftDeps): Promise<DraftResult> {
  if (input.notes.length > NOTES_MAX) return { ok: false, kind: "invalid", error: `Keep your notes for Farah under ${NOTES_MAX} characters.` };
  if (input.currentBody.length > BODY_MAX || input.currentSubject.length > SUBJECT_MAX) {
    return { ok: false, kind: "invalid", error: "That message is too long for Farah to work on." };
  }

  if (!(await deps.hasPremium(input.organizationId))) {
    return { ok: false, kind: "premium_required", error: "Drafting and refining with Farah is part of Premium." };
  }

  const charge = { organizationId: input.organizationId, userId: input.userId, amountNgn: FARAH_MESSAGE_DRAFT_NGN };
  const debit = await deps.debit(charge);
  if (debit.failed) {
    console.error("[applicant-message-draft] the ad wallet debit failed");
    return { ok: false, kind: "generation_error", error: "Couldn't check your ad wallet balance. Try again." };
  }
  if (!debit.ok) {
    return {
      ok: false,
      kind: "insufficient_balance",
      error: `Not enough ad wallet balance: a Farah draft costs ₦${FARAH_MESSAGE_DRAFT_NGN.toLocaleString("en-NG")}. Top up to use it.`,
    };
  }

  async function refund(reason: string): Promise<DraftResult> {
    console.error(`[applicant-message-draft] ${reason}: reversing the charge`);
    const credited = await deps.credit(charge).catch(() => ({ failed: true }));
    if (credited.failed) console.error(`[applicant-message-draft] reversal FAILED after: ${reason}`);
    return { ok: false, kind: "generation_error", error: "Farah couldn't draft that just now, and you weren't charged. Try again." };
  }

  let draft: { subject: string; body: string };
  try {
    const { candidateFirstName, senderFirstName, jobTitle, orgName, kind, mode, notes, currentSubject, currentBody } = input;
    draft = await deps.generate({ kind, mode, jobTitle, orgName, candidateFirstName, senderFirstName, notes, currentSubject, currentBody });
  } catch {
    return refund("the model call failed");
  }

  const normalized = normalizeMessage({ subject: draft?.subject, body: draft?.body });
  if (!normalized.ok) return refund("the draft was empty or unusable");

  const invented = findInventedPromise(`${normalized.subject}\n${normalized.body}`, `${input.notes}\n${input.currentSubject}\n${input.currentBody}`);
  if (invented) return refund("the draft contained something the employer never wrote");

  return { ok: true, subject: normalized.subject, body: normalized.body };
}
