import { CHAT_MAX_OUTPUT_TOKENS, REQUEST_TOKEN_CEILING } from "./token-budget";

/**
 * Farah chat's daily spend ceiling: an app-level safeguard that stops chat for the rest of the UTC day once the day's ESTIMATED spend reaches a configured amount, well before
 * the model provider's own monthly limit. Spend is an estimate: the provider's reported token counts times the provider's published price for the model that ran. The
 * provider's console is the source of truth. This module is pure (no database, no server-only import); the counter it reads is src/lib/farah/spend-tally.ts (migration 0223).
 *
 * Money is whole nano-dollars (1 nano-dollar = 10^-9 USD), so nothing here is floating-point arithmetic on dollars.
 */
export const NANO_PER_USD = 1_000_000_000;

/** The owner's default, in USD per UTC day. The ONE place the number lives; FARAH_DAILY_SPEND_CEILING_USD overrides it at request time. */
export const DEFAULT_DAILY_CEILING_USD = 1;

export const GROQ_PRICE_SOURCE = { url: "https://console.groq.com/docs/model/openai/gpt-oss-120b", readOn: "2026-10-04" } as const;
export const GEMINI_PRICE_SOURCE = { url: "https://ai.google.dev/gemini-api/docs/pricing", readOn: "2026-10-04" } as const;

interface PriceRow {
  provider: string;
  model: string;
  /** Nano-dollars per token. */
  inputNanoPerToken: number;
  outputNanoPerToken: number;
}
/**
 * Groq openai/gpt-oss-120b: $0.15 per 1M input tokens and $0.60 per 1M output tokens. Gemini gemini-3.6-flash is priced at the published 2027 rate ($1.50 / $7.50 per 1M) even while the 2026 rate is
 * lower, so no date logic is needed and the estimate errs high. Reasoning tokens are already inside the output count both providers report.
 */
const PRICE_ROWS: readonly PriceRow[] = [
  { provider: "groq", model: "openai/gpt-oss-120b", inputNanoPerToken: 150, outputNanoPerToken: 600 },
  { provider: "gemini", model: "gemini-3.6-flash", inputNanoPerToken: 1500, outputNanoPerToken: 7500 },
];
/** An unknown provider or model is priced at the MOST expensive known row, per class: the estimate may be too high, never too low. */
const DEAREST = {
  inputNanoPerToken: Math.max(...PRICE_ROWS.map((r) => r.inputNanoPerToken)),
  outputNanoPerToken: Math.max(...PRICE_ROWS.map((r) => r.outputNanoPerToken)),
};

function whole(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The estimated cost of one reply from the provider's reported token counts, rounded UP to a whole nano-dollar. Bad counts price as zero tokens. */
export function estimateSpendNano(u: { provider?: string; model?: string; inputTokens: number; outputTokens: number }): number {
  const row = PRICE_ROWS.find((r) => r.provider === u.provider && r.model === u.model) ?? DEAREST;
  return Math.ceil(whole(u.inputTokens) * row.inputNanoPerToken + whole(u.outputTokens) * row.outputNanoPerToken);
}

/** A failed or aborted model call, with no token counts: a typical request (2,400 in, 500 out) at the Groq row. Most failures bill nothing, so this is already pessimistic. */
export const FAILED_ATTEMPT_ESTIMATE_NANO = estimateSpendNano({ provider: "groq", model: "openai/gpt-oss-120b", inputTokens: 2400, outputTokens: 500 });
/** A completed reply that reported no counts: the worst the request caps allow, at the most expensive row. */
export const NO_COUNTS_REPLY_ESTIMATE_NANO = estimateSpendNano({ inputTokens: REQUEST_TOKEN_CEILING, outputTokens: CHAT_MAX_OUTPUT_TOKENS });

/** The ceiling in USD: FARAH_DAILY_SPEND_CEILING_USD when it is a positive plain decimal, otherwise the default. A bad value falls back, never to "no limit". */
export function dailyCeilingUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FARAH_DAILY_SPEND_CEILING_USD?.trim();
  if (raw && /^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_DAILY_CEILING_USD;
}

/** Whole seconds to the next 00:00:00 UTC, for a Retry-After header: at least 1, at most a day. */
export function secondsUntilUtcMidnight(d: Date): number {
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.min(86_400, Math.max(1, Math.ceil((next - d.getTime()) / 1000)));
}

/** Database error codes that say the counter's function or table is not there: migration 0223 has not been applied to this project. */
export const MISSING_OBJECT_CODES: ReadonlySet<string> = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);

/** The one content-free log line for a failure reaching the counter: the tag and the error CODE only, never the error's own text. */
export function counterFailureLine(err: unknown): string {
  const code = typeof (err as { code?: unknown } | null)?.code === "string" ? ((err as { code: string }).code) : null;
  const hint = code && MISSING_OBJECT_CODES.has(code) ? "; the usage function or table is missing, so migration 0223 may not be applied" : "";
  return `[farah-spend:counter-failed] code=${code ?? "none"}${hint}`;
}

/**
 * HOW FAR PARALLEL REQUESTS CAN OVERSHOOT THE CEILING. The check reads today's total before the model call and the reply is added after it completes, so requests that start within one reply's duration
 * (at most about a minute: a 20 s client timeout, up to three attempts) all pass against the same total. Each provider's own limit bounds how much they can then spend: spend cannot outrun what the provider admits.
 * Two providers can serve a request, so there are two bounds, and they are independent:
 *  - Groq (the configured provider): 250,000 tokens a minute. Source: console figure, unverified (the owner read it from the Groq console on 4 Oct 2026; it was relayed here and has not been checked by anyone else). Priced entirely as output tokens: $0.15.
 *  - The Gemini fallback (used only when Groq answers rate-limited before its first token): 20 requests a day. That is the project's own record of the fallback key as a free-tier key (CLAUDE.md, README.md), not a
 *    reading of Google's console, and the repo does not say whether the key has been upgraded since; if it has, this term is unknown until its limits are read. At the largest request the route allows, priced at the
 *    Gemini row, it is 20 x $0.01818 = $0.3636.
 * WITHOUT the fallback guard (below) the bound at the default ceiling is the sum, $0.5136 (about 51% of $1.00); WITH it, only Groq's $0.15 is left (15%). Each is an ABSOLUTE amount that does not shrink with the ceiling.
 * Reserving before the call is not needed at the default; it is the thing to revisit if the ceiling is lowered towards the Groq bound.
 */
export const GROQ_ORG_TOKENS_PER_MINUTE = 250_000;
export const MAX_REPLY_WINDOW_SECONDS = 60;
export const OVERSHOOT_BOUND_NANO = estimateSpendNano({ provider: "groq", model: "openai/gpt-oss-120b", inputTokens: 0, outputTokens: GROQ_ORG_TOKENS_PER_MINUTE });
export const GEMINI_FALLBACK_REQUESTS_PER_DAY = 20;
export const GEMINI_OVERSHOOT_BOUND_NANO =
  GEMINI_FALLBACK_REQUESTS_PER_DAY * estimateSpendNano({ provider: "gemini", model: "gemini-3.6-flash", inputTokens: REQUEST_TOKEN_CEILING, outputTokens: CHAT_MAX_OUTPUT_TOKENS });
export const TOTAL_OVERSHOOT_BOUND_NANO = OVERSHOOT_BOUND_NANO + GEMINI_OVERSHOOT_BOUND_NANO;

/**
 * THE FALLBACK GUARD. Before the fallback provider is used, today's total is read again, and the fallback is used only if the headroom (ceiling minus total) covers everything the fallback could add in a
 * day: FALLBACK_RESERVE_NANO, its daily request cap times its worst-case request. Once allowed, total <= ceiling - reserve, and the fallback's whole day fits inside the reserve, so it can never add past the
 * ceiling. What is left is the primary provider's own bound: GUARDED_OVERSHOOT_BOUND_NANO ($0.15, 15% of the default ceiling) against TOTAL_OVERSHOOT_BOUND_NANO ($0.5136, 51%) without the guard.
 * ASSUMPTION: the reserve rests on GEMINI_FALLBACK_REQUESTS_PER_DAY above, which is the project's own record that the fallback key is a free-tier key (20 requests a day), not a reading of Google's console.
 * IF THE FALLBACK KEY'S TIER CHANGES (an upgrade, a new key, a different model), RECALCULATE: set GEMINI_FALLBACK_REQUESTS_PER_DAY to the new daily cap, and FALLBACK_RESERVE_NANO (derived from it) follows. If the
 * new tier has no daily request cap, there is no bound to reserve against: decide a cap here before relying on the fallback. The runbook (docs/farah-spend-ceiling-runbook.md) says the same.
 */
export const FALLBACK_RESERVE_NANO = GEMINI_OVERSHOOT_BOUND_NANO;
export const GUARDED_OVERSHOOT_BOUND_NANO = OVERSHOOT_BOUND_NANO;

/** True when the headroom covers the fallback's whole-day reserve. Exactly the reserve left is enough. */
export function fallbackAllowed(spentNano: number, ceilingNano: number): boolean {
  return ceilingNano - spentNano >= FALLBACK_RESERVE_NANO;
}

/** Reads today's total and answers `fallbackAllowed` with the configured ceiling. A read failure throws: the caller treats it as "no fallback". */
export async function checkFallbackHeadroom(tally: { read(): Promise<number> }, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const ceilingNano = Math.round(dailyCeilingUsd(env) * NANO_PER_USD);
  return fallbackAllowed(await tally.read(), ceilingNano);
}

/** The daily-ceiling response (entry check): the day's budget is used. */
export const FARAH_RESTING_MESSAGE = "Farah is resting for today. Please try again tomorrow.";
/** What the person sees when the primary provider is rate-limited and the fallback is declined. True because a reply that did not complete is neither charged nor counted against the free messages. */
export const FARAH_BUSY_MESSAGE = "Farah is busy right now. Please try again in a few minutes. You haven't been charged for this message.";

export interface SpendTallyReader {
  read(): Promise<number>;
  markWarned(): Promise<boolean>;
}

export interface CeilingCheck {
  status: "ok" | "blocked";
  spentNano: number;
  ceilingNano: number;
}

/**
 * Reads today's total and compares it with the ceiling. A failure to READ throws (the caller fails closed: a counter that cannot be read is not "zero spent"). At half the ceiling, the first
 * caller of the day writes one content-free warning line; a failure to mark that is swallowed, because the warning is a convenience and the ceiling is the safeguard.
 */
export async function checkSpendCeiling(tally: SpendTallyReader, env: Record<string, string | undefined> = process.env): Promise<CeilingCheck> {
  const ceilingNano = Math.round(dailyCeilingUsd(env) * NANO_PER_USD);
  const spentNano = await tally.read();
  if (spentNano >= ceilingNano) return { status: "blocked", spentNano, ceilingNano };
  if (spentNano >= ceilingNano / 2) {
    try {
      if (await tally.markWarned()) console.warn("[farah-spend:half] today's estimated Farah spend has reached 50% of the daily ceiling");
    } catch {
      /* the warning is optional */
    }
  }
  return { status: "ok", spentNano, ceilingNano };
}
