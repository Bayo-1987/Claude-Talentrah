/**
 * The envelope mark shared by both check-email pages. A plain server
 * component — no client behavior, just markup — shared so the two pages'
 * icon chips can't drift from each other pixel-for-pixel.
 *
 * Path shapes and the rust stroke color are pulled from the validated
 * reference mockup (check-email-redesign.html), not eyeballed: a rectangle
 * plus a chevron/flap line, `--rust` stroke on a `bg-rust-soft` chip — the
 * same accent already used for the eyebrow label directly below it, no new
 * color introduced.
 */
export function CheckEmailIcon() {
  return (
    <div className="flex h-[46px] w-[46px] items-center justify-center bg-rust-soft">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--rust)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2.5" y="4.5" width="19" height="15" rx="0" />
        <path d="M3 6l9 6.5L21 6" />
      </svg>
    </div>
  );
}
