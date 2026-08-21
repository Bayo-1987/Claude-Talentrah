import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Max content width 1120px, padding 0 40px (design handoff §5). */
export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1120px] px-10", className)}
      {...props}
    />
  );
}
