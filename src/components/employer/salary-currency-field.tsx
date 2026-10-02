import {
  SALARY_CURRENCIES,
  salaryCurrencySelection,
  type SalaryCurrency,
} from "@/lib/employer/salary-input";

/** Code first (what is stored), name after (what a person recognises). No currency glyphs: see the naira ratchets. */
const CURRENCY_LABELS: Record<SalaryCurrency, string> = {
  NGN: "NGN — Nigerian naira",
  USD: "USD — US dollar",
  GBP: "GBP — British pound",
  EUR: "EUR — Euro",
  CAD: "CAD — Canadian dollar",
  KES: "KES — Kenyan shilling",
  GHS: "GHS — Ghanaian cedi",
  ZAR: "ZAR — South African rand",
};

/**
 * The salary currency control: a select of the eight ISO codes, never free
 * text (see salary-input.ts — it stores the code exactly as picked, and the
 * server re-checks it).
 *
 * `stored` is what the posting already holds (edit page / URL import) and wins
 * when present; `fallback` is the employer's country default for a posting
 * with nothing stored. Uncontrolled (`defaultValue`), like every other field
 * on this form — a URL import remounts the whole form to apply new defaults.
 *
 * A stored code outside the eight renders a disabled "Select a currency"
 * placeholder as the selection instead of silently showing a different code
 * beside the same amount.
 */
export function SalaryCurrencyField({
  stored,
  fallback,
  required,
}: {
  stored: string | null | undefined;
  fallback: SalaryCurrency;
  required: boolean;
}) {
  const selection = salaryCurrencySelection(stored, fallback);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="salaryCurrency" className="font-body text-[13px] font-semibold text-ink-soft">
        Salary currency
      </label>
      <select
        id="salaryCurrency"
        name="salaryCurrency"
        defaultValue={selection}
        required={required}
        className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
      >
        {selection === "" && (
          <option value="" disabled>
            Select a currency
          </option>
        )}
        {SALARY_CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {CURRENCY_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
