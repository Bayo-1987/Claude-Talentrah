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
          "min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust",
          error && "border-rust",
          className,
        )}
        {...props}
      />
      {error && <p className="text-[12.5px] text-rust">{error}</p>}
    </div>
  );
}
