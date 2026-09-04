import { cn } from "@/lib/cn";

/**
 * Placeholder blocks for `loading.tsx` route skeletons.
 *
 * ── WHY THESE EXIST ───────────────────────────────────────────────────────
 *
 * With no `loading.tsx` anywhere, the App Router had nothing to show between
 * a nav click and the server finishing its render: the OLD page stayed on
 * screen, unchanged, for as long as the new one took. Every click looked
 * like nothing had happened. A route segment with a loading file also gives
 * Next.js something to prefetch a dynamic route UP TO, which the app was
 * getting no benefit from either.
 *
 * ── WHAT A GOOD SKELETON LOOKS LIKE HERE ──────────────────────────────────
 *
 * NOT a centred spinner. Each `loading.tsx` in this app renders the page's
 * real eyebrow and real heading — those are static strings, known without
 * touching the database — and uses these blocks only for the parts that
 * genuinely have to be fetched. So the masthead, the page title and the
 * shape of the content all paint immediately, and only the data fades in.
 * A spinner would throw away information the server already has.
 *
 * ── DESIGN SYSTEM ─────────────────────────────────────────────────────────
 *
 * NO BORDER RADIUS. The house rule is no radius anywhere except genuinely
 * circular affordances, and a skeleton is the classic place it creeps in —
 * every UI library ships rounded ones. These are square, like everything
 * else on the page they stand in for.
 *
 * The fill is `--line`, the hairline tone, at low opacity: it is the
 * quietest ink in the palette, so a page of placeholders reads as paper
 * with structure rather than as a grey wireframe.
 *
 * `motion-reduce:animate-none` — the pulse is decoration, and someone who
 * has asked their system for less motion should get a static block, not a
 * throbbing one. The layout is identical either way.
 */
export function SkeletonBlock({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-line/40 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A bordered card's worth of placeholder — the shape most of this app's
 * content actually takes (1.5px ink border, no radius, `--card` ground).
 *
 * Takes the border from the real thing rather than faking it with a filled
 * block, so the page's structure is correct at first paint and only the
 * contents settle. That is what stops the swap to real content from looking
 * like a layout jump.
 */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("border-[1.5px] border-line bg-card p-4", className)}
    >
      <SkeletonBlock className="h-4 w-1/3" />
      <div className="mt-3 flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonBlock
            key={i}
            /* Last line short, like real ragged text ending mid-measure. */
            className={cn("h-3", i === lines - 1 ? "w-2/5" : "w-full")}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The one piece of copy in a skeleton that is read aloud.
 *
 * Everything else here is `aria-hidden` — a screen reader announcing twelve
 * grey rectangles is worse than silence. This gives assistive tech (and
 * anyone on a slow connection who wonders whether the click registered) a
 * single honest status line instead.
 *
 * `role="status"` with `aria-live="polite"` so it is announced when it
 * appears and does not interrupt anything mid-sentence.
 *
 * NO TIME ESTIMATE, deliberately — the content rule against unmeasured
 * promises ("in 10 seconds") applies here as much as to AI output, and this
 * is exactly the place a well-meaning "just a moment…" turns into a claim
 * the server cannot keep on a bad connection.
 *
 * ── WHY THE data-testid, WHEN role=status IS RIGHT THERE ──────────────────
 *
 * Because `getByRole("status")` is NOT unique on these pages, and trusting
 * that it was made e2e/nav-responsiveness.spec.ts pass with every single
 * `loading.tsx` deleted from the tree. FarahFirstVisitHint also carries
 * `role="status"`, it renders from (app)/layout.tsx — OUTSIDE this
 * boundary, so it is attached before the navigation even starts — and it
 * shows for exactly the profile a fresh test user has. The spec was
 * matching that and measuring nothing.
 *
 * So the hook is explicit. `role=status` stays because it is the correct
 * semantics for a human; the testid is what makes an assertion about THIS
 * element actually about this element.
 */
export const ROUTE_LOADING_TESTID = "route-loading";

export function SkeletonStatus({ children = "Loading…" }: { children?: string }) {
  return (
    <p
      data-testid={ROUTE_LOADING_TESTID}
      role="status"
      aria-live="polite"
      className="sr-only"
    >
      {children}
    </p>
  );
}
