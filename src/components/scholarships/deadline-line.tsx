/**
 * The deadline line every scholarship surface renders (card, detail page, landing page): an optional "Deadline:" label, then the text.
 *
 * The label is omitted when the sentence already carries the date and says "deadline" itself (`labelled` is false for the no-zone "last day" and
 * "passed in some time zones" states, see scholarshipDeadlineDisplay in src/lib/scholarships/close-instant.ts): "Deadline: Last day: deadline
 * 2 Oct 2026, ..." would say it three times. One component, so no surface can render both.
 */
export function DeadlineLine({
  text,
  urgent,
  labelled = true,
  labelClassName = "font-semibold",
  calmClassName,
  valueDataAttr,
}: {
  text: string;
  urgent: boolean;
  labelled?: boolean;
  labelClassName?: string;
  /** Class for the value when it is not urgent (the landing page sets one explicitly). */
  calmClassName?: string;
  /** Sets `data-deadline` on the value span (the landing page's tests and analytics read it). */
  valueDataAttr?: string;
}) {
  return (
    <>
      {labelled && <span className={labelClassName}>Deadline:</span>}
      {labelled && " "}
      <span className={`wrap-anywhere ${urgent ? "font-semibold text-rust" : (calmClassName ?? "")}`.trim()} data-deadline={valueDataAttr}>
        {text}
      </span>
    </>
  );
}
