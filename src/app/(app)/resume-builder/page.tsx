import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel, buttonClasses } from "@/components/ui";
import { TemplateCard } from "@/components/resume-builder/template-card";
import { EmptySkillsNotice } from "@/components/resume-builder/empty-skills-notice";
import { ResumeListRow } from "@/components/resume-builder/resume-list-row";
import { PanelShell } from "@/components/resume-builder/panel-shell";
import { shouldShowEmptySkillsNotice } from "@/lib/resume/empty-skills-notice";

export const metadata = { title: "Resume Builder — Talentrah" };

const PAGE_SIZE = 6;

type SearchParams = Promise<{ category?: string; q?: string; page?: string; atsSafe?: string }>;

function buildHref(base: Record<string, string | undefined>, changes: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  const merged = { ...base, ...changes };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/resume-builder?${qs}` : "/resume-builder";
}

export default async function ResumeBuilderPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const category = params.category ?? "";
  const q = (params.q ?? "").trim();
  const atsSafeOnly = params.atsSafe === "1";
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

  const [
    { data: resumes },
    { data: templates, count },
    { data: categoryRows },
    { data: unlocks },
    { data: baseResume },
    { data: profile },
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
    ]);

  const showEmptySkillsNotice = shouldShowEmptySkillsNotice(
    baseResume,
    profile?.resume_skills_notice_dismissed_at,
  );

  const categories = Array.from(new Set((categoryRows ?? []).map((r) => r.industry_category))).sort();
  const unlockedIds = new Set((unlocks ?? []).map((u) => u.template_id));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const base = { category: category || undefined, q: q || undefined, atsSafe: atsSafeOnly ? "1" : undefined };

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
        <EyebrowLabel size="sm">Two ways to start</EyebrowLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PanelShell
            eyebrow="Build a resume"
            title="Pick a template below"
            description="Browse the gallery and start filling it in — Farah helps sharpen the wording as you go."
          >
            <a
              href="#template-gallery"
              className="w-fit text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              ↓ Jump to the gallery
            </a>
          </PanelShell>
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
            href={buildHref(base, { category: undefined, page: undefined })}
            className={
              !category
                ? "flex min-h-10 items-center border-b-[2.5px] border-rust font-body text-[13.5px] font-bold text-ink no-underline"
                : "flex min-h-10 items-center border-b-[2.5px] border-transparent font-body text-[13.5px] font-bold text-ink-soft no-underline"
            }
          >
            All categories
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={buildHref(base, { category: c, page: undefined })}
              className={
                category === c
                  ? "flex min-h-10 items-center border-b-[2.5px] border-rust font-body text-[13.5px] font-bold text-ink no-underline"
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
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search templates by name…"
            className="min-h-11 w-full max-w-[320px] border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[14px] outline-none focus:border-rust"
          />
          {q && (
            <Link
              href={buildHref(base, { q: undefined, page: undefined })}
              className="text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
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
        <Link
          href={buildHref(base, { atsSafe: atsSafeOnly ? undefined : "1", page: undefined })}
          className={
            atsSafeOnly
              ? "flex min-h-10 w-fit items-center gap-2 border-[1.5px] border-ink bg-ink px-3 font-body text-[13px] font-semibold text-paper no-underline"
              : "flex min-h-10 w-fit items-center gap-2 border-[1.5px] border-ink bg-card px-3 font-body text-[13px] font-semibold text-ink no-underline hover:border-rust hover:text-rust"
          }
        >
          ATS-safe only
        </Link>

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
                href={buildHref(base, { page: page - 1 === 1 ? undefined : `${page - 1}` })}
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
              <Link href={buildHref(base, { page: `${page + 1}` })} className="font-semibold underline underline-offset-2">
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
