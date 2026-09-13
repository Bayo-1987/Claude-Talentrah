import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, className, id, ...props }: TextFieldProps) {
  const inputId = id ?? props.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="font-body text-[13px] font-semibold text-ink-soft"
      >
        {label}
      </label>
      <input
        id={inputId}
        className={cn(
          /*
           * rounded-2xl, not the search combobox's full rounded-full pill —
           * checked both .dc.html reference files first: neither mocks up a
           * plain text input, only the search box (a 999px pill) and the
           * hero JD-tailoring textarea, whose own OUTER container already
           * ships at rounded-[20px] (jd-demo-input.tsx). That's Card's own
           * 14-20px range, not a pill, so a "type into me" field takes
           * Card's radius (Card itself uses rounded-2xl) rather than a
           * pill shape that reads right on a button or a search box but odd
           * on a Company name / Email field.
           */
          "min-h-11 rounded-2xl border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-coral",
          error && "border-coral",
          className,
        )}
        {...props}
      />
      {error && <p className="text-[12.5px] text-coral">{error}</p>}
    </div>
  );
}
