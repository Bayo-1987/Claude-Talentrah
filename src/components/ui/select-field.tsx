import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: readonly string[];
  placeholder?: string;
}

export function SelectField({
  label,
  error,
  options,
  placeholder = "Select…",
  className,
  id,
  ...props
}: SelectFieldProps) {
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
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && <p className="text-[12.5px] text-rust">{error}</p>}
    </div>
  );
}
