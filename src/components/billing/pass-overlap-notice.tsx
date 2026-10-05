/** One plain sentence that a second pass runs alongside the first (see passOverlapNotice in billing-view.ts). Shown next to Buy and in the other-pass view. */
export function PassOverlapNotice({ text, onDark = false }: { text: string; onDark?: boolean }) {
  return (
    <p
      data-testid="pass-overlap-notice"
      className={onDark ? "text-[13px] text-line" : "max-w-[760px] border-[1.5px] border-line bg-paper-alt px-4 py-3 text-[13.5px] text-ink-soft"}
    >
      {text}
    </p>
  );
}
