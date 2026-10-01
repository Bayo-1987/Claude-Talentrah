import { notFound } from "next/navigation";
import { DEMO_CONFIGS, renderTemplateConfig } from "@/components/resume-builder/skeletons";
import { TemplateRenderer, registeredSlugs } from "@/components/resume-builder/templates";
import { ResumePrintSurface } from "@/components/resume-builder/resume-print-surface";
import { PRINT_FIXTURE_RESUME, PRINT_FIXTURE_TAILORED_RAW } from "@/lib/resume-builder/print-fixture";
import { normaliseTailoredResume } from "@/lib/tailoring/normalise";

/**
 * QA-only, same convention as `/dev/template-skeletons/[configKey]` and
 * `/dev/design-check`: reached by URL, no masthead, no auth, no database.
 *
 * Renders `PRINT_FIXTURE_RESUME` (several pages, 18 certifications, bulleted
 * achievements) the way the two real print surfaces do — the seeker's live
 * preview and the employer's applicant view — so `e2e/resume-print-margins.spec.ts`
 * can `page.pdf()` it and measure the space at each page break.
 *
 * `?source=tailored` renders `PRINT_FIXTURE_TAILORED_RAW` — the same resume as
 * a sloppy tailoring response would hand it back, achievements glued into one
 * string or typed as dash lines — AFTER `normaliseTailoredResume`, the pass
 * `tailorResumeToJob` ends with. That lets the spec follow bullets from
 * model-shaped output into a real PDF.
 *
 * `[template]` is a skeleton demo key (`DEMO_CONFIGS`) or a registered
 * template slug; anything else is a 404 rather than a silent fallback to the
 * default template, so a typo in a spec cannot pass by measuring the wrong page.
 */
export default async function ResumePrintFixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ template: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { template } = await params;
  const { source } = await searchParams;
  const demo = DEMO_CONFIGS[template];
  if (!demo && !registeredSlugs().includes(template)) notFound();

  const resume = source === "tailored" ? normaliseTailoredResume(PRINT_FIXTURE_TAILORED_RAW) : PRINT_FIXTURE_RESUME;

  return (
    <div className="bg-paper">
      <ResumePrintSurface>
        {demo ? renderTemplateConfig(demo, resume) : <TemplateRenderer slug={template} resume={resume} />}
      </ResumePrintSurface>
    </div>
  );
}
