import { notFound } from "next/navigation";
import { DEMO_CONFIGS, renderTemplateConfig } from "@/components/resume-builder/skeletons";
import { ATS_TEST_RESUME } from "@/lib/resume-builder/ats-test-fixture";

/**
 * QA-only, same convention as `/dev/design-check` (see that page's own
 * header): not linked from anywhere a real visitor lands, reached by URL
 * only, and outside the `(app)` route group so it renders with no masthead/
 * nav chrome around it — exactly what a resume document itself looks like.
 *
 * THIS PAGE IS THE ONE THING `e2e/ats-safety.spec.ts`
 * ACTUALLY CHECKS. The PR brief requires the ATS-safety claim to be proven
 * against a real generated PDF, not asserted from reading the JSX — so this
 * route exists to give Playwright something real to `page.pdf()` against,
 * rendering the exact shared fixture (`ATS_TEST_RESUME`) through the exact
 * shared per-skeleton demo configs (`DEMO_CONFIGS`) the test also imports.
 * No Supabase/auth dependency on purpose, so the route works in every
 * environment the test runs in, including one with no seeded catalog.
 */
export default async function TemplateSkeletonQaPage({
  params,
}: {
  params: Promise<{ configKey: string }>;
}) {
  const { configKey } = await params;
  const config = DEMO_CONFIGS[configKey];
  if (!config) notFound();

  return <div className="bg-paper">{renderTemplateConfig(config, ATS_TEST_RESUME)}</div>;
}
