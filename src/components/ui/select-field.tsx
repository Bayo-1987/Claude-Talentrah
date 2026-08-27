import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * An option is either a bare string — value and label the same — or the two
 * spelled apart.
 *
 * Needed the moment a select is backed by a database enum: `bug` is the right
 * column value and the wrong thing to show a person. Bare strings stay
 * supported, so every existing caller is untouched.
 */
export type SelectOption = string | { value: string; label: string };

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: readonly SelectOption[];
  placeholder?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, error, options, placeholder = "Select…", className, id, ...props },
    ref,
  ) {
    const selectId = id ?? props.name;

    /*
     * The placeholder only appears if something selects it.
     *
     * `<option value="" disabled>` renders first, but a browser skips a
     * disabled option when nothing is selected and lands on the first REAL
     * one — so the field arrived pre-answered and `required` was satisfied by
     * a choice the person never made. On the contact form that meant every
     * untouched submission read "General question"; on the feedback form it
     * meant an idea filed as a bug.
     *
     * Only when the caller supplies neither `value` nor `defaultValue`. A
     * caller that states either is controlling the selection deliberately —
     * signup passes `defaultValue={fields.country}` (initially "", which is
     * why signup was already correct) and the tracker passes "saved" — and
     * overriding those would be a different bug in the other direction.
     */
    const unset = props.value === undefined && props.defaultValue === undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={selectId}
          className="font-body text-[13px] font-semibold text-ink-soft"
        >
          {label}
        </label>
        <select
          ref={ref}
          id={selectId}
          {...(unset ? { defaultValue: "" } : {})}
          className={cn(
            "min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust",
            error && "border-rust",
            className,
          )}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const label = typeof option === "string" ? option : option.label;
            return (
              <option key={value} value={value}>
                {label}
              </option>
            );
          })}
        </select>
        {error && <p className="text-[12.5px] text-rust">{error}</p>}
      </div>
    );
  },
);
