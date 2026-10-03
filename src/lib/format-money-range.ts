/**
 * The one place a pair of money bounds becomes words (S1-26 item 8). /mentorship once told a visitor "sessions currently range from
 * ₦20,000 to ₦20,000": with a single priced mentor the minimum equals the maximum, so the "range" was one number twice. Every money
 * range shown anywhere (a mentor price range, a job salary) is built here, so the equal-bounds case is handled in exactly one place.
 *
 * Rules, in the default "words" style:
 *   - equal bounds: one amount ("₦20,000 per session"), never a range;
 *   - different bounds: "from ₦X to ₦Y";
 *   - one bound: "from ₦X" / "up to ₦Y";
 *   - no usable bound, or a currency Intl cannot format: null, so the caller leaves the sentence out entirely.
 * The "compact" style is the job-card form ("₦X – ₦Y", "From ₦X", "Up to ₦Y"), kept exactly as formatSalary always printed it.
 *
 * `unit` is the noun the page supplies ("per session", "per month"); it is appended to whatever the range reads as.
 * Each range keeps its OWN currency: amounts come from Intl.NumberFormat in the en-NG locale, so NGN prints "₦20,000" as one
 * string (the ₦ stays next to its digits), USD prints "US$90,000", EUR "€90,000", and an unregistered code falls back to its own
 * code-prefix. en-NG is the base locale for the reason format-salary.ts gives: ICU prints "NGN" under a generic English locale.
 */
const LOCALE = "en-NG";

export interface MoneyRangeOptions {
  /** The noun the page supplies, e.g. "per session". */
  unit?: string;
  style?: "words" | "compact";
}

/** `numeric` columns can arrive as strings over PostgREST: never trust the declared type over what came back. */
function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** True when the two bounds are one amount (equal), so a caller can word the sentence around it ("a session costs X"). */
export function isSingleAmount(min: number | string | null | undefined, max: number | string | null | undefined): boolean {
  const lo = toFiniteNumber(min);
  const hi = toFiniteNumber(max);
  return lo !== undefined && lo === hi;
}

export function formatMoneyRange(
  min: number | string | null | undefined,
  max: number | string | null | undefined,
  currency: string,
  options: MoneyRangeOptions = {},
): string | null {
  let lo = toFiniteNumber(min);
  let hi = toFiniteNumber(max);
  if (lo === undefined && hi === undefined) return null;
  if (lo !== undefined && hi !== undefined && lo > hi) [lo, hi] = [hi, lo];

  const compact = options.style === "compact";
  let amount: string;
  try {
    const fmt = new Intl.NumberFormat(LOCALE, { style: "currency", currency, maximumFractionDigits: 0 });
    if (lo !== undefined && hi !== undefined) {
      if (lo === hi) amount = fmt.format(lo);
      else amount = compact ? `${fmt.format(lo)} – ${fmt.format(hi)}` : `from ${fmt.format(lo)} to ${fmt.format(hi)}`;
    } else if (lo !== undefined) {
      amount = `${compact ? "From" : "from"} ${fmt.format(lo)}`;
    } else {
      amount = `${compact ? "Up to" : "up to"} ${fmt.format(hi!)}`;
    }
  } catch {
    // A currency Intl genuinely cannot format is the same "nothing honest to show" case as no bounds at all.
    return null;
  }
  return options.unit ? `${amount} ${options.unit}` : amount;
}
