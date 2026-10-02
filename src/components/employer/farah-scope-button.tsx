import { Button, FarahMark } from "@/components/ui";

/**
 * "Let Farah scope this job" — the post-a-job form's opt-in AI draft button.
 *
 * Carries Farah's own mark (the two overlapping circles, FarahMark) rather
 * than a text sparkle glyph: the design system allows inline SVG as icons and
 * nothing else, and Farah is the abstract mark. The
 * mark is `aria-hidden` (FarahMark sets it), so the button's accessible name
 * is exactly its words.
 */
export function FarahScopeButton({
  disabled,
  drafting,
  onClick,
}: {
  disabled: boolean;
  drafting: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="secondary" disabled={disabled} onClick={onClick} className="gap-2">
      <FarahMark size={20} />
      {drafting ? "Farah is scoping this job…" : "Let Farah scope this job"}
    </Button>
  );
}
