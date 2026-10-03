/**
 * Reading the employer form's salary fields, and the currency list behind them.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * Same reason as expiry-input.ts: it lived in actions.ts, a `"use server"`
 * file that may only export async functions, which left the validation with
 * no test seam except through a Server Action (and so a database).
 *
 * ── THE CURRENCY IS A CODE, NOT TEXT ──────────────────────────────────────
 *
 * `salary_currency` is read by search listing data (job-posting-jsonld.ts's
 * baseSalary) and by the salary formatter, both of which need an ISO 4217
 * code. The form used to be a free-text box that upper-cased whatever was
 * typed, so "usd" became "USD" and "XXX" (ISO's "no currency" code) was
 * accepted as a real one. It is now a select of the eight currencies the
 * product's markets use — and, because a hand-crafted POST never touches the
 * select, THIS file is the gate: the value must equal one of the eight
 * exactly. No trimming, no case folding: "usd " and "usd" are rejected, not
 * repaired, so what is stored is always exactly what a person picked.
 */
import { Constants, type Enums } from "@/lib/supabase/types";
import { countryCodeForLabel, resolveCountryCode } from "@/lib/jobs/countries";

/** Trims a form field to a string, mirroring actions.ts' own reader. */
function str(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function optionalEnum<T extends string>(form: FormData, key: string, allowed: readonly T[]): T | null {
  const value = str(form, key);
  return allowed.includes(value as T) ? (value as T) : null;
}

/** Order is the select's order: the home market first, then the diaspora and regional currencies. */
export const SALARY_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "CAD", "KES", "GHS", "ZAR"] as const;
export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number];

/** Used when there is no country to go on (unset, blank, or a value that names no country). */
export const DEFAULT_SALARY_CURRENCY: SalaryCurrency = "NGN";

export function isSalaryCurrency(value: string): value is SalaryCurrency {
  return (SALARY_CURRENCIES as readonly string[]).includes(value);
}

const COUNTRY_CURRENCY: Readonly<Record<string, SalaryCurrency>> = {
  NG: "NGN",
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  KE: "KES",
  GH: "GHS",
  ZA: "ZAR",
};

/** The 27 EU member states (alpha-2). */
const EU_COUNTRIES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];

/** A listed country with no currency of its own on the list (and "Other") gets this, not the naira default above. */
export const UNMAPPED_COUNTRY_SALARY_CURRENCY: SalaryCurrency = "USD";

/**
 * The currency to preselect for an employer in `country` (a name as the signup form stores it — "Nigeria", "Georgia" — or an
 * alpha-2 code). The seven mapped countries and the EU members keep their own currency. Any other country on the signup list,
 * and "Other", is USD: a global default, since the list is every country and most are not Nigerian. Only a value that says
 * nothing (unset, blank) or names no country at all stays NGN, the home market. This is a form default only: it preselects the
 * posting form's currency select and is never stored on a profile.
 */
export function defaultSalaryCurrency(country: string | null | undefined): SalaryCurrency {
  if (!country || !country.trim()) return DEFAULT_SALARY_CURRENCY;
  // A dropdown value is unambiguous (Georgia is GE), so try the exact label first; then free text and alpha-2 codes.
  const code = countryCodeForLabel(country) ?? resolveCountryCode(country);
  if (!code) return country.trim() === "Other" ? UNMAPPED_COUNTRY_SALARY_CURRENCY : DEFAULT_SALARY_CURRENCY;
  if (EU_COUNTRIES.includes(code)) return "EUR";
  return COUNTRY_CURRENCY[code] ?? UNMAPPED_COUNTRY_SALARY_CURRENCY;
}

/**
 * What the select should show: the stored code when there is one, otherwise
 * the country default. A stored code OUTSIDE the eight (an imported posting
 * stating "JPY") is shown as no selection at all — "" — rather than quietly
 * re-labelled as something else next to the same amount; the employer must
 * choose, and the server will refuse the save until they do.
 */
export function salaryCurrencySelection(stored: string | null | undefined, fallback: SalaryCurrency): string {
  if (!stored) return fallback;
  return isSalaryCurrency(stored) ? stored : "";
}

export type SalaryFields = {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: SalaryCurrency | null;
  salary_unit: Enums<"salary_unit"> | null;
};

/**
 * All four salary columns travel together or not at all — see migration
 * 0085 and job-posting-jsonld.ts's baseSalary note for why a bound with no
 * currency is treated as no salary at all. Unlike the ingestion parser
 * (which silently OMITS a malformed baseSalary so one bad source field never
 * costs a whole listing), this is a human filling in one form field at a
 * time, so the right behaviour is a clear inline error, not a silent drop —
 * the same reasoning readExpiry already applies to a hand-typed date.
 */
export function readSalaryForm(form: FormData): { ok: true; value: SalaryFields } | { ok: false; error: string } {
  const minRaw = str(form, "salaryMin");
  const maxRaw = str(form, "salaryMax");
  // Deliberately NOT `str()`: no trimming, no case folding (see the header).
  const rawCurrency = form.get("salaryCurrency");
  const currency = typeof rawCurrency === "string" ? rawCurrency : "";
  const unit = optionalEnum<Enums<"salary_unit">>(form, "salaryUnit", Constants.public.Enums.salary_unit);

  const min = minRaw ? Number(minRaw) : null;
  const max = maxRaw ? Number(maxRaw) : null;
  if (min !== null && !Number.isFinite(min)) return { ok: false, error: "Minimum salary isn't a number." };
  if (max !== null && !Number.isFinite(max)) return { ok: false, error: "Maximum salary isn't a number." };

  // A present-but-invalid currency is an error whether or not there is an
  // amount: the select only ever sends one of the eight, so anything else is a
  // hand-built request, and dropping it silently would hide that.
  if (currency !== "" && !isSalaryCurrency(currency)) {
    return { ok: false, error: `Salary currency must be one of ${SALARY_CURRENCIES.join(", ")}.` };
  }

  if (min === null && max === null) {
    // No amount at all — currency and period without an amount describe
    // nothing, so they are dropped rather than half-saved.
    return { ok: true, value: { salary_min: null, salary_max: null, salary_currency: null, salary_unit: null } };
  }
  if (!isSalaryCurrency(currency)) return { ok: false, error: "Add a currency for the salary, or clear both amounts." };
  if (min !== null && max !== null && max < min) {
    return { ok: false, error: "Maximum salary can't be less than the minimum." };
  }

  return { ok: true, value: { salary_min: min, salary_max: max, salary_currency: currency, salary_unit: unit } };
}
