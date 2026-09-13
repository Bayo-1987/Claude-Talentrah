import { notFound } from "next/navigation";
import {
  CATALOG_TEMPLATE_CONFIGS,
  DEMO_CONFIGS,
  renderTemplateConfig,
} from "@/components/resume-builder/skeletons";
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
 *
 * TEMPLATE LIBRARY PR3 ALSO REACHES THIS ROUTE BY REAL CATALOG SLUG, not just
 * by `DEMO_CONFIGS` key: `CATALOG_TEMPLATE_CONFIGS` (the same map
 * `src/lib/billing/catalog.ts` and `templates/index.tsx`'s registry both read
 * from) is a plain, DB-free object too, so
 * `/dev/template-skeletons/<any-of-the-58-slugs>` renders that exact
 * production config against the same fixture — what
 * `e2e/ats-safety.spec.ts` uses to give a handful of PR3's new
 * templates (one representative per skeleton, plus the four fixed fallback
 * slugs) a real PDF-extraction check without needing Supabase either.
 */
export default async function TemplateSkeletonQaPage({
  params,
}: {
  params: Promise<{ configKey: string }>;
}) {
  const { configKey } = await params;
  const config = DEMO_CONFIGS[configKey] ?? CATALOG_TEMPLATE_CONFIGS[configKey];
  if (!config) notFound();

  return <div className="bg-bg">{renderTemplateConfig(config, ATS_TEST_RESUME)}</div>;
}
