import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { TemplateCard } from "@/components/resume-builder/template-card";

export const metadata = { title: "Resume Builder — Talentrah" };

const PAGE_SIZE = 6;

type SearchParams = Promise<{ category?: string; q?: string; page?: string }>;

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

  const [{ data: resumes }, { data: templates, count }, { data: categoryRows }, { data: unlocks }] =
    await Promise.all([
      supabase
        .from("resumes")
        .select("id, title, is_base, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      templatesQuery,
      supabase.from("resume_templates").select("industry_category"),
      supabase.from("user_template_unlocks").select("template_id").eq("user_id", user.id),
    ]);

  const categories = Array.from(new Set((categoryRows ?? []).map((r) => r.industry_category))).sort();
  const unlockedIds = new Set((unlocks ?? []).map((u) => u.template_id));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const base = { category: category || undefined, q: q || undefined };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <EyebrowLabel>Resume Builder</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">Build a resume that fits the role.</h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Pick a template, fill in your details, and let Farah help sharpen the wording.
          Already have a role in mind?{" "}
          <Link href="/tailor" className="underline underline-offset-2">
            Tailor your resume and generate a cover letter
          </Link>
          .
        </p>
      </div>

      {resumes && resumes.length > 0 && (
        <div className="flex flex-col gap-3">
          <EyebrowLabel size="sm">Your resumes</EyebrowLabel>
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {resumes.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-3">
                <div>
                  <span className="font-body text-[14.5px] font-semibold">
                    {r.title}
                    {r.is_base && (
                      <span className="ml-2 text-[12px] font-normal text-ink-soft">
                        (from your uploaded resume)
                      </span>
                    )}
                  </span>
                  <div className="text-[12.5px] text-ink-soft">
                    Updated {new Date(r.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Link
                    href={`/resume-builder/edit?resumeId=${r.id}`}
                    className="text-[13px] font-semibold underline underline-offset-2"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/resume-builder/preview?resumeId=${r.id}`}
                    className="text-[13px] font-semibold underline underline-offset-2"
                  >
                    Preview
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
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

        <form method="GET" action="/resume-builder" className="flex items-center gap-2">
          {category && <input type="hidden" name="category" value={category} />}
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

        {(templates ?? []).length === 0 ? (
          <p className="py-8 text-center text-[14.5px] text-ink-soft">
            No templates match — try a different search or category.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
