import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel, buttonClasses } from "@/components/ui";
import { TemplateCard } from "@/components/resume-builder/template-card";
import { EmptySkillsNotice } from "@/components/resume-builder/empty-skills-notice";
import { ResumeListRow } from "@/components/resume-builder/resume-list-row";
import { PanelShell } from "@/components/resume-builder/panel-shell";
import { shouldShowEmptySkillsNotice } from "@/lib/resume/empty-skills-notice";
import { buildGalleryHref } from "@/lib/resume-builder/gallery-href";

export const metadata = { title: "Resume Builder — Talentrah" };

const PAGE_SIZE = 6;

type SearchParams = Promise<{ category?: string; q?: string; page?: string; atsSafe?: string; freeOnly?: string }>;

export default async function ResumeBuilderPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const category = params.category ?? "";
  const q = (params.q ?? "").trim();
  const atsSafeOnly = params.atsSafe === "1";
  // send-119: 56 of 65 templates are premium — a reader hits a locked card
  // roughly 6 times out of 7 with no way to filter it out before clicking
  // in. "Free templates only" over a three-way All/Free/Premium toggle
  // because the premium case is the common one; a control built to isolate
  // it would spend UI space on the rarer need.
  const freeOnly = params.freeOnly === "1";
  const page = Math.max(1, Number(params.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let templatesQuery = supabase
    .from("resume_templates")
    .select("*", { count: "exact" })
    .order("industry_category")
    .order("name")
    .range(from, to);
  if (category) templatesQuery = templatesQuery.eq("industry_category", category);
  if (q) templatesQuery = templatesQuery.ilike("name", `%${q}%`);
  // ATS-safe filter (PR brief) — a real column check, not a client-side
  // filter over the page's own rows, so it filters the whole catalog rather
  // than just whatever page you happened to be on.
  if (atsSafeOnly) templatesQuery = templatesQuery.eq("ats_safe", true);
  // Same shape as ats_safe above — composes with it and with category/q
  // rather than any of them silently overriding the others, since each is
  // its own independent .eq()/.ilike() chained onto the same query.
  if (freeOnly) templatesQuery = templatesQuery.eq("is_premium", false);

  const [
    { data: resumes },
    { data: templates, count },
    { data: categoryRows },
    { data: unlocks },
    { data: baseResume },
    { data: profile },
    { data: defaultImportTemplate },
  ] =
    await Promise.all([
      supabase
        .from("resumes")
        .select("id, title, is_base, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      templatesQuery,
      supabase.from("resume_templates").select("industry_category"),
      supabase.from("user_template_unlocks").select("template_id").eq("user_id", user.id),
      /*
       * The base resume's parsed skills, and whether this user has already
       * said they know it is empty (#145).
       *
       * Selected as its own query rather than widened onto the list above:
       * that one renders every resume a user has and needs four small columns
       * from each, while this needs one large jsonb blob from exactly one row.
       * Pulling `structured_content` for the whole list to reach a single
       * array would grow with the number of resumes for no gain.
       */
      supabase
        .from("resumes")
        .select("id, structured_content")
        .eq("user_id", user.id)
        .eq("is_base", true)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("resume_skills_notice_dismissed_at")
        .eq("id", user.id)
        .maybeSingle(),
      /*
       * send-119: a real template id to send an "already have a resume?"
       * import shortcut to, since ImportPanel/createResumeAction need SOME
       * templateId even though upload+parse itself doesn't depend on which
       * one — free and ATS-safe so the shortcut never routes someone
       * straight into a premium unlock wall or a template least likely to
       * survive an ATS scan. Picked live rather than hardcoded: a specific
       * UUID baked into this file would silently break the moment that row
       * is renamed, unpublished, or reordered.
       */
      supabase
        .from("resume_templates")
        .select("id")
        .eq("is_premium", false)
        .eq("ats_safe", true)
        .order("name")
        .limit(1)
        .maybeSingle(),
    ]);

  const showEmptySkillsNotice = shouldShowEmptySkillsNotice(
    baseResume,
    profile?.resume_skills_notice_dismissed_at,
  );

  const categories = Array.from(new Set((categoryRows ?? []).map((r) => r.industry_category))).sort();
  const unlockedIds = new Set((unlocks ?? []).map((u) => u.template_id));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const base = {
    category: category || undefined,
    q: q || undefined,
    atsSafe: atsSafeOnly ? "1" : undefined,
    freeOnly: freeOnly ? "1" : undefined,
  };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <EyebrowLabel>Resume Builder</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">Build a resume that fits the role.</h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Pick a template, fill in your details, and let Farah help sharpen the wording.
        </p>
      </div>

      {/*
        Cover-letter generation used to have exactly one mention on this whole
        page — a clause riding along inside the intro paragraph above, easy to
        skim past. This gives it equal visual weight with the resume path
        instead, reusing PanelShell (the New Resume screen's own three-way
        chooser shape) rather than inventing a second card pattern for the
        same idea. The "Build a resume" side is informational only — the
        gallery is the very next thing on the page — so its own action is a
        real anchor down to it, not a fake button-styled span.

        Still honest about the constraint this doesn't remove: /tailor still
        needs a real job description before Farah can write anything. This
        makes that visible instead of hiding it inside a sentence; it does
        not add a way around it.
      */}
      <div className="flex flex-col gap-3">
        <EyebrowLabel size="sm">{defaultImportTemplate ? "Three ways to start" : "Two ways to start"}</EyebrowLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <PanelShell
            eyebrow="Build a resume"
            title="Pick a template below"
            description="Browse the gallery and start filling it in — Farah helps sharpen the wording as you go."
          >
            <a
              href="#template-gallery"
              className="w-fit text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
            >
              ↓ Jump to the gallery
            </a>
          </PanelShell>
          {/*
            send-119: the gallery below is a REAL prerequisite for uploading a
            CV, not just a suggestion — "Import my CV" only appears after a
            template is picked, one click into /resume-builder/new. A reader
            who already has a resume file and lands on this page has no way
            to know that; this card puts the shortcut where they'd actually
            look for it, going straight to the chooser with a real,
            free/ATS-safe templateId already resolved so it never dead-ends
            on a locked template. Omitted rather than shown broken on the
            rare chance no free ATS-safe template exists.
          */}
          {defaultImportTemplate && (
            <PanelShell
              eyebrow="Already have a resume?"
              title="Import it"
              description="Upload your resume and Farah pulls in your details — pick a template after, or keep this one."
            >
              <Link
                href={`/resume-builder/new?templateId=${defaultImportTemplate.id}`}
                className={buttonClasses("primary", "sm", "no-underline w-fit")}
              >
                Import my resume →
              </Link>
            </PanelShell>
          )}
          <PanelShell
            eyebrow="Generate a cover letter"
            title="Tailor one to a real job"
            description="Paste the job description you're applying to and Farah writes a cover letter around it."
          >
            <Link href="/tailor" className={buttonClasses("primary", "sm", "no-underline w-fit")}>
              Tailor a cover letter →
            </Link>
          </PanelShell>
        </div>
      </div>

      {showEmptySkillsNotice && baseResume && <EmptySkillsNotice baseResumeId={baseResume.id} />}

      {resumes && resumes.length > 0 && (
        <div className="flex flex-col gap-3">
          <EyebrowLabel size="sm">Your resumes</EyebrowLabel>
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {resumes.map((r) => (
              <ResumeListRow
                key={r.id}
                id={r.id}
                title={r.title}
                isBase={r.is_base}
                updatedAt={r.updated_at}
              />
            ))}
          </div>
        </div>
      )}

      <div id="template-gallery" className="flex flex-col gap-4 scroll-mt-6">
        <EyebrowLabel size="sm">Template gallery</EyebrowLabel>

        <div className="flex flex-wrap items-center gap-6 border-b border-line pb-3">
          <Link
            href={buildGalleryHref(base, { category: undefined, page: undefined })}
            className={
              !category
                ? "flex min-h-10 items-center border-b-[2.5px] border-coral font-body text-[13.5px] font-bold text-ink no-underline"
                : "flex min-h-10 items-center border-b-[2.5px] border-transparent font-body text-[13.5px] font-bold text-ink-soft no-underline"
            }
          >
            All categories
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={buildGalleryHref(base, { category: c, page: undefined })}
              className={
                category === c
                  ? "flex min-h-10 items-center border-b-[2.5px] border-coral font-body text-[13.5px] font-bold text-ink no-underline"
                  : "flex min-h-10 items-center border-b-[2.5px] border-transparent font-body text-[13.5px] font-bold text-ink-soft no-underline"
              }
            >
              {c}
            </Link>
          ))}
        </div>

        <form method="GET" action="/resume-builder" className="flex flex-wrap items-center gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          {atsSafeOnly && <input type="hidden" name="atsSafe" value="1" />}
          {freeOnly && <input type="hidden" name="freeOnly" value="1" />}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search templates by name…"
            className="min-h-11 w-full max-w-[320px] border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[14px] outline-none focus:border-coral"
          />
          {q && (
            <Link
              href={buildGalleryHref(base, { q: undefined, page: undefined })}
              className="text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
            >
              Clear search
            </Link>
          )}
        </form>

        {/*
          A real filter over the whole catalog (see the `.eq("ats_safe", true)`
          query above), not just a label on each card — someone who needs an
          ATS-safe resume specifically shouldn't have to read all eleven cards
          to find the three that qualify.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildGalleryHref(base, { atsSafe: atsSafeOnly ? undefined : "1", page: undefined })}
            className={
              atsSafeOnly
                ? "flex min-h-10 w-fit items-center gap-2 border-[1.5px] border-ink bg-ink px-3 font-body text-[13px] font-semibold text-bg no-underline"
                : "flex min-h-10 w-fit items-center gap-2 border-[1.5px] border-ink bg-card px-3 font-body text-[13px] font-semibold text-ink no-underline hover:border-coral hover:text-coral"
            }
          >
            ATS-safe only
          </Link>
          {/*
            send-119: 56 of 65 templates are premium — this composes with
            category/q/atsSafe exactly the way ATS-safe does above (its own
            .eq() chained onto the same query, its own key in `base` carried
            through buildGalleryHref), rather than resetting the others.
          */}
          <Link
            href={buildGalleryHref(base, { freeOnly: freeOnly ? undefined : "1", page: undefined })}
            className={
              freeOnly
                ? "flex min-h-10 w-fit items-center gap-2 border-[1.5px] border-ink bg-ink px-3 font-body text-[13px] font-semibold text-bg no-underline"
                : "flex min-h-10 w-fit items-center gap-2 border-[1.5px] border-ink bg-card px-3 font-body text-[13px] font-semibold text-ink no-underline hover:border-coral hover:text-coral"
            }
          >
            Free templates only
          </Link>
        </div>

        {(templates ?? []).length === 0 ? (
          <p className="py-8 text-center text-[14.5px] text-ink-soft">
            No templates match — try a different search or category.
          </p>
        ) : (
          /*
            Two columns, not three (Stage 3.2) — deliberately capped here even
            on very wide screens. With eleven templates total, the gallery can
            afford to show each one large enough to actually evaluate (see
            template-thumbnail.tsx's own note on the size bump that came with
            this), and a third column would just squeeze the thumbnail back
            toward the illegible size this change exists to fix. Stage 6's
            65-template expansion is expected to revisit this — a much bigger
            catalog is exactly the case a denser grid earns its keep for.
          */
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {(templates ?? []).map((t) => (
              <TemplateCard key={t.id} template={t} isUnlocked={unlockedIds.has(t.id)} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-2 text-[13.5px]">
            {page > 1 ? (
              <Link
                href={buildGalleryHref(base, { page: page - 1 === 1 ? undefined : `${page - 1}` })}
                className="font-semibold underline underline-offset-2"
              >
                ← Previous
              </Link>
            ) : (
              <span className="text-ink-soft/50">← Previous</span>
            )}
            <span className="text-ink-soft">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildGalleryHref(base, { page: `${page + 1}` })} className="font-semibold underline underline-offset-2">
                Next →
              </Link>
            ) : (
              <span className="text-ink-soft/50">Next →</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
