import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ResumeBuilderCta } from "@/components/seo/resume-builder-cta";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * Standalone SEO landing page for "resume builder Nigeria" / "AI resume
 * builder Africa" and adjacent terms — the same uncontested-keyword gap
 * /ai-resume-tailoring and /ats-resume-checker close (see those pages' own
 * headers), for the Resume Builder feature specifically. Unlike those two,
 * there was no existing homepage copy to draw from (hero/problem/how-it-
 * works sections describe only the JD-paste tailoring flow, never the
 * template gallery or bullet rewriting) — this page's content is grounded
 * directly in build-prompt §6.4 rather than lifted from anywhere on-site.
 *
 * `/resume-builder` itself (the in-app tool) is auth-gated and disallowed in
 * robots.ts — this page is the public, indexable front door to it, the same
 * relationship /ai-resume-tailoring has to /tailor.
 */
export const metadata: Metadata = pageMetadata({
  title: "Free AI Resume Builder for Nigerian Job Seekers — Talentrah",
  description:
    "Build a resume with industry-specific templates and AI bullet rewriting, made for the Nigerian and African job market — start free, no design skill required.",
  path: "/ai-resume-builder",
});

export default function AiResumeBuilderPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[820px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>AI resume builder</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              A resume that reads well, built without a design tool.
            </h1>
            <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
              Pick a template built for your industry, fill it in, and let
              Farah sharpen your bullet points as you go. No spreadsheet
              gymnastics, no wrestling a document editor into a resume shape.
            </p>
            <div className="mt-2">
              <ResumeBuilderCta />
            </div>
          </div>

          <div className="flex flex-col gap-5 border-t border-line pt-10">
            <EyebrowLabel>What&apos;s in the builder</EyebrowLabel>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Templates by industry
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    A gallery organized by field — tech, finance, healthcare,
                    government, and dozens more — instead of one generic
                    layout stretched to fit every role.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    AI bullet rewriting
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Turn a flat task description into a bullet that actually
                    shows impact, one line at a time, in your own editor.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Drag-and-reorder editing
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Reorder sections and entries directly, and preview the
                    finished layout as you edit rather than guessing how it
                    will export.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Free to start
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Several templates are free with no account limits — more
                    industry-specific templates unlock with Talentrah
                    Credits as you need them.
                  </p>
                </BorderedCard>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>Built for the Nigerian job market</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              The templates and bullet rewriting here are built around the
              roles and industries Nigerian and African job seekers actually
              apply to — not a US-market template gallery with a handful of
              generic categories bolted on.
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              Already have a resume you want tailored to one job?
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              Paste a job description and Talentrah will tailor your resume
              and cover letter to that specific role.
            </p>
            <Link
              href="/ai-resume-tailoring"
              className="w-fit text-[13.5px] font-semibold text-rust underline underline-offset-2"
            >
              See how AI resume tailoring works →
            </Link>
          </BorderedCard>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
