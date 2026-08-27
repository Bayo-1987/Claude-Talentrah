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
