import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "text";
export type ButtonSize = "md" | "sm";

const base =
  "inline-flex items-center justify-center rounded-none font-body font-semibold transition-colors";

const variantSizeClasses: Record<ButtonSize, Record<ButtonVariant, string>> = {
  md: {
    primary:
      "bg-ink text-paper border-none min-h-[48px] px-[30px] py-[15px] text-[15px] hover:bg-rust",
    secondary:
      "bg-transparent text-ink border-[1.5px] border-ink min-h-[44px] px-[28px] py-[13px] text-[15px] hover:border-rust hover:text-rust",
    ghost:
      "bg-transparent text-ink border-none min-h-[44px] px-[6px] py-[10px] text-[15px] hover:text-rust",
    text: "bg-transparent text-ink-soft border-none min-h-[44px] px-[2px] py-[10px] text-[13.5px] underline underline-offset-3 hover:text-rust",
  },
  sm: {
    primary:
      "bg-ink text-paper border-none min-h-[40px] px-[18px] py-[10px] text-[13.5px] hover:bg-rust",
    secondary:
      "bg-transparent text-ink border border-line min-h-[40px] px-[16px] py-[10px] text-[13px] hover:border-rust hover:text-rust",
    ghost:
      "bg-transparent text-ink-soft border-none min-h-[40px] px-[4px] py-[8px] text-[13px] hover:text-rust",
    text: "bg-transparent text-ink-soft border-none min-h-[40px] px-[2px] py-[8px] text-[13px] underline underline-offset-2 hover:text-rust",
  },
};

/**
 * Class-only version of Button's styling, for a non-<button> element that
 * needs to look like one — e.g. a <Link> CTA. Never nest a <Button> inside
 * an <a>/<Link>: that's invalid HTML (a real shipped bug, twice now) — apply
 * these classes to the link itself instead. Lives outside button.tsx (which
 * is "use client") since this is pure string logic Server Components need
 * to call directly.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(base, variantSizeClasses[size][variant], className);
}
