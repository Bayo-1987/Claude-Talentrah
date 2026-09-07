import type { StructuredResume } from "@/lib/resume/types";
import { SingleColumnSkeleton } from "./skeletons/single-column";
import { CLEAN_PROFESSIONAL_CONFIG } from "./skeletons/configs";

/**
 * `clean-professional` — the free default, and the fallback every unmapped
 * slug renders as (`DEFAULT_TEMPLATE_SLUG` in `templates/index.tsx`).
 *
 * TEMPLATE LIBRARY PR 2 OF 3: this used to be ~100 lines of hand-written JSX
 * (see `tests/resume-builder/__fixtures__/pre-schema-widen/resume-document.tsx`
 * for exactly what it looked like). It is now the one existing template
 * moved onto the new layout-skeleton + style-token system
 * (`src/components/resume-builder/skeletons/`) — chosen because it's the
 * skeleton system's own `single-column` skeleton in its most literal form,
 * which makes it the cleanest proof that the system can reproduce an
 * existing template exactly rather than approximately.
 *
 * "Exactly" is verified, not asserted: `CLEAN_PROFESSIONAL_CONFIG`
 * (skeletons/configs.ts) was built by reverse-deriving each style token from
 * this component's original literal classNames, and
 * `tests/resume-builder/schema-widen-render-parity.test.tsx` — unmodified
 * from PR1 — still passes, because it byte-compares this component's output
 * against a `git show` snapshot of the pre-PR2 JSX above for both an
 * old-shape and an empty resume. If a future edit to the skeleton system or
 * this config changes so much as a class name, that test fails.
 *
 * WHY THIS FILE STILL EXISTS AND ISN'T JUST DELETED IN FAVOR OF THE CONFIG.
 * `getTemplateComponent("clean-professional")` is asserted elsewhere
 * (template-registry.test.ts) to be `.toBe()` this exact export — i.e. an
 * identity check, not a behavioral one. Keeping `ResumeDocument` as a real,
 * named, importable component (rather than inlining the skeleton call at the
 * registry) is what keeps that identity check meaningful instead of forcing
 * it to change for an unrelated architectural reason.
 */
export function ResumeDocument({ resume }: { resume: StructuredResume }) {
  return <SingleColumnSkeleton resume={resume} config={CLEAN_PROFESSIONAL_CONFIG} />;
}
