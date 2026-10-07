/**
 * send-493 — the text every credit-spending control shows next to its action.
 *
 * ONE RULE: a price shown to a user is read from `CREDIT_COSTS` here, never typed into a component. A literal
 * "· 2 credits" on a button keeps saying 2 after a repricing; tests/credits/every-spender-shows-its-cost.test.tsx
 * swaps the whole price list and fails any control that still shows the old number, and scans the components
 * for a typed-in "N credits".
 *
 * Pure strings and decisions, no React and no I/O, so the same helpers serve client components, server pages
 * and tests. The charging itself is not here and is not changed by this file: these only DESCRIBE what the
 * gates (tailoring/gate.ts, farah/chat-gate.ts) and the Server Actions already do.
 */
import { CREDIT_COSTS } from "@/lib/credits/costs";
import type { FarahMessageCharge } from "@/lib/credits/farah-message-charge";
import { formatWeekdayAtTime, viewerTimeZone } from "@/lib/format/datetime";

export function creditsPhrase(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}

/** "2 credits", or "included with your Pass" when a Pass covers the action (a covered user is never shown a price). */
export function priceText({ cost, passCovered = false }: { cost: number; passCovered?: boolean }): string {
  return passCovered ? "included with your Pass" : creditsPhrase(cost);
}

export function withPrice(label: string, price: string): string {
  return `${label} · ${price}`;
}

/** What a control that spends `cost` credits should read, e.g. "Request verification · 25 credits". */
export function priced(label: string, cost: number, passCovered = false): string {
  return withPrice(label, priceText({ cost, passCovered }));
}

export interface TailoringPricing {
  /** The one-time free tailoring run is still unused. */
  tailoringFree: boolean;
  /** The one-time free cover letter is still unused. */
  coverLetterFree: boolean;
  /** An active Pass covers tailoring and cover letters right now (checkPassCoverage, not just "has a Pass"). */
  passCovered: boolean;
  /** The account's credit balance as the page was rendered. */
  balance: number;
}

export interface Charge {
  kind: "free" | "pass" | "credits";
  credits: number;
}

/**
 * What one tailoring submit will cost THIS account, mirroring checkTailoringAllowance in
 * src/lib/tailoring/gate.ts, which is what actually decides: a Pass covers it first (and no free run is spent),
 * then each of tailoring and cover letter is free once, then credits. The cover letter is only part of the
 * charge when it is ticked.
 */
export function tailoringCharge(opts: {
  tailoringFree: boolean;
  coverLetterFree: boolean;
  passCovered: boolean;
  includeCoverLetter: boolean;
}): Charge {
  if (opts.passCovered) return { kind: "pass", credits: 0 };
  let credits = 0;
  if (!opts.tailoringFree) credits += CREDIT_COSTS.tailoringRun;
  if (opts.includeCoverLetter && !opts.coverLetterFree) credits += CREDIT_COSTS.coverLetterRun;
  return credits === 0 ? { kind: "free", credits: 0 } : { kind: "credits", credits };
}

export function tailorButtonLabel(charge: Charge, balance: number): string {
  switch (charge.kind) {
    case "pass":
      return "Tailor my resume · included with your Pass";
    case "free":
      return "Tailor my resume · free run";
    case "credits":
      return `Tailor my resume · ${creditsPhrase(charge.credits)} (you have ${balance})`;
  }
}

/**
 * The /tailor intro sentence. The "your first run is free" claim is scoped to the accounts it is true for:
 * once the free run is used it must not be on the page at all (it read as a promise the button then broke).
 */
export function tailoringIntro(p: { tailoringFree: boolean; coverLetterFree: boolean; passCovered: boolean }): string {
  const base =
    "Farah reads the real requirements, shows what's matched and missing, and returns a tailored resume with an ATS score.";
  if (p.passCovered) return `${base} Included with your Pass — no credits used.`;
  if (p.tailoringFree && p.coverLetterFree) return `${base} Your first tailoring run (and first cover letter) are free.`;
  if (p.tailoringFree) return `${base} Your first tailoring run is free.`;
  if (p.coverLetterFree) return `${base} Your first cover letter is free; a tailoring run uses credits — the button shows the price.`;
  return `${base} Each run uses credits — the button shows the price before you confirm.`;
}

/**
 * Whether a Farah quick-action chip may SEND on click. Three different answers hide in `freeRemaining`:
 *   - a number above zero: the message is free, send;
 *   - `null`: KNOWN and unrationed (a Pass holder, whom the free counter does not ration), send;
 *   - `0`: the free messages are used, so a send would charge: prefill and let the user press Send;
 *   - `undefined`: NOT KNOWN YET (the panel loads the count from /api/farah/history after it mounts). Prefill
 *     here too. A click in that window used to send, and the message could be a paid one: found by the e2e,
 *     which clicked a chip straight after page load.
 */
export function quickActionMode(freeRemaining: number | null | undefined): "send" | "prefill" {
  return freeRemaining === null || (typeof freeRemaining === "number" && freeRemaining > 0) ? "send" : "prefill";
}

/** The allowance line split around its date, so a screen can render the date as a <time> element. `text` is the three parts joined. */
export interface FarahAllowanceParts {
  lead: string;
  when: { iso: string; label: string } | null;
  tail: string;
  text: string;
}

/**
 * What the panel keeps from `nextFreeMessageAt` on a response: an ISO instant (a date AND a time) as sent, anything else null. The foundation sends an
 * ISO string or null; a value of any other shape is never guessed into a date.
 */
export function readNextFreeMessageAt(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * The line under Farah's greeting about the free-message allowance (0123), from what the foundation returns: `freeRemaining` (a number; `null` for an active
 * Pass, `undefined` while unknown: both give no text) and `nextFreeMessageAt` (an ISO instant or null). The date is named only once the free messages are
 * used up and only while it is in the future; null, unreadable or past means no date and no date sentence, never a guess. The date is in the viewer's zone
 * (`timeZone`, default the browser's) as "Fri 9 Oct at 14:20", with no zone label. `now` is a parameter for tests.
 */
export function farahAllowanceText({
  freeRemaining,
  nextFreeMessageAt,
  now = new Date(),
  timeZone = viewerTimeZone(),
}: {
  freeRemaining: number | null | undefined;
  nextFreeMessageAt?: unknown;
  now?: Date;
  timeZone?: string;
}): FarahAllowanceParts | null {
  if (freeRemaining === null || freeRemaining === undefined) return null;
  if (freeRemaining > 0) {
    const text = `${freeRemaining} free message${freeRemaining === 1 ? "" : "s"} left.`;
    return { lead: text, when: null, tail: "", text };
  }
  const price = creditsPhrase(CREDIT_COSTS.farahChatMessage);
  const iso = readNextFreeMessageAt(nextFreeMessageAt);
  const label = iso !== null && Date.parse(iso) > now.getTime() ? formatWeekdayAtTime(iso, { timeZone }) : "";
  if (iso !== null && label !== "") {
    const lead = "You've used your free messages. Your next free message is available on ";
    const tail = `. Until then, each message costs ${price}.`;
    return { lead, when: { iso, label }, tail, text: `${lead}${label}${tail}` };
  }
  const text = `You've used your free messages. Each message costs ${price}.`;
  return { lead: text, when: null, tail: "", text };
}

export function farahAllowanceLine(freeRemaining: number): string {
  return farahAllowanceText({ freeRemaining })?.text ?? "";
}

/**
 * The only text a Farah chip shows about cost, BEFORE the click, from the same charge the gate takes (farah-message-charge.ts). null = show nothing (the count is not known: the chip is disabled).
 * "free", "included with your Pass", "1 credit", or "1 credit (you have 0)" for a message the gate would refuse. It reads the same inputs as farahAllowanceText and says the same price
 * (tests/farah/chip-cost-agrees-with-allowance-line.test.ts holds the two together, state by state).
 */
export function farahChipCostLabel(charge: FarahMessageCharge): string | null {
  switch (charge.kind) {
    case "unknown":
      return null;
    case "free":
      return "free";
    case "pass":
      return priceText({ cost: 0, passCovered: true });
    case "credits":
      return creditsPhrase(charge.credits);
    case "insufficient":
      return `${creditsPhrase(charge.required)} (you have ${charge.available})`;
  }
}

/**
 * The polite announcement when the LAST free message was just used: the chat `done` event brought the count to 0 and the message was not a paid one.
 * Says the date when there is a usable future one, otherwise only the price. Null in every other case (a paid message, free messages left, a Pass, unknown).
 */
export function farahFreeUsedAnnouncement({
  freeRemaining,
  paid,
  nextFreeMessageAt,
  now,
  timeZone,
}: {
  freeRemaining: number | null | undefined;
  paid: boolean;
  nextFreeMessageAt?: unknown;
  now?: Date;
  timeZone?: string;
}): string | null {
  if (freeRemaining !== 0 || paid) return null;
  const parts = farahAllowanceText({ freeRemaining, nextFreeMessageAt, now, timeZone });
  if (!parts) return null;
  return parts.when
    ? `No free messages left. Your next free message is available on ${parts.when.label}.`
    : `No free messages left. Each message costs ${creditsPhrase(CREDIT_COSTS.farahChatMessage)}.`;
}

/** The polite live-region text: the result and the charge together, e.g. "Rewritten — 2 credits used". */
export function chargeAnnouncement(verb: string, credits: number): string {
  return credits > 0 ? `${verb} — ${creditsPhrase(credits)} used` : `${verb} — no credits used`;
}
