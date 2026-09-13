import Link from "next/link";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { buttonClasses } from "@/lib/button-classes";

/**
 * The heading block every queue shares.
 *
 * It names the signed-in operator on each screen, which is not decoration:
 * these actions are now attributed, and an operator should be able to see
 * whose name is going on the record before they click. That was the concrete
 * payoff of building the session first, so it is stated where the decision is
 * made rather than only on the dashboard home.
 */
export function QueueHeader({
  eyebrow,
  title,
  blurb,
  adminLabel,
  newHref,
  newLabel,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  adminLabel: string;
  newHref?: string;
  newLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <EyebrowLabel>{eyebrow}</EyebrowLabel>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-[30px] leading-[1.2]">{title}</h1>
        {newHref && newLabel && (
          <Link href={newHref} className={buttonClasses("secondary", "sm")}>
            {newLabel}
          </Link>
        )}
      </div>
      <p className="max-w-[640px] text-[15px] text-ink-soft">{blurb}</p>
      <p className="font-display text-[14px] italic text-ink-soft">
        Deciding as {adminLabel}.
      </p>
    </div>
  );
}

export function QueueEmpty({ children }: { children: React.ReactNode }) {
  return (
    <BorderedCard className="p-6">
      <p className="font-display text-[15px] italic text-ink-soft">{children}</p>
    </BorderedCard>
  );
}

export { Container };
