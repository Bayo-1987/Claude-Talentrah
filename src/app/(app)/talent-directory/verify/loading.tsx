import { Container, EyebrowLabel, SkeletonCard, SkeletonStatus } from "@/components/ui";

/**
 * Talent Directory verification, loading. Eyebrow and heading are constants
 * in page.tsx; the two BorderedCard sections below it (opt-in status,
 * verification/portfolio state) are what genuinely depend on a fetch.
 *
 * SAFE ONLY BECAUSE /talent-directory IS NOW IN seekerAppGate's protected
 * prefixes (src/proxy.ts) — this page has no notFound() of its own, but it
 * DOES redirect a signed-out visitor via a page-level requireUser() call,
 * and that redirect would have regressed the same way #221 documented had
 * this loading.tsx been added without the middleware gate. Confirmed
 * directly before and after that change.
 */
export default function TalentDirectoryVerifyLoading() {
  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <SkeletonStatus>Loading your Talent Directory profile…</SkeletonStatus>

      <div>
        <EyebrowLabel>Talent Directory</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px] font-semibold">Get verified</h1>
      </div>

      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </Container>
  );
}
