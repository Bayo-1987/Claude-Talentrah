import { BorderedCard, EyebrowLabel } from "@/components/ui";

/**
 * A bordered card with an eyebrow, a title, a description, and whatever
 * action the caller wants below it — the shape the New Resume screen's
 * three-way chooser uses for each of its panels (start-state-chooser.tsx).
 *
 * Extracted here rather than left as a private function in that file once
 * the Resume Builder page's own "two ways to start" section needed the
 * exact same shape — two copies of one visual pattern is what this
 * codebase's own conventions warn against when there's no real reason for
 * two (contrast the masthead's own "copied deliberately" note, which
 * applies when two things merely look alike but mean something different;
 * this is the opposite case, the same thing used twice).
 */
export function PanelShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <EyebrowLabel size="sm">{eyebrow}</EyebrowLabel>
      <h3 className="text-[16px]">{title}</h3>
      <p className="flex-1 text-[13.5px] text-ink-soft">{description}</p>
      {children}
    </BorderedCard>
  );
}
