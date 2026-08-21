import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { createResumeAction } from "@/lib/resume-builder/actions";
import { EyebrowLabel, BorderedCard, Button } from "@/components/ui";

export const metadata = { title: "Resume Builder — Talentrah" };

export default async function ResumeBuilderPage() {
  const { user } = await requireUser();
  const supabase = await createClient();

  const [{ data: resumes }, { data: templates }] = await Promise.all([
    supabase
      .from("resumes")
      .select("id, title, is_base, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase.from("resume_templates").select("*").order("industry_category"),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <EyebrowLabel>Resume Builder</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">Build a resume that fits the role.</h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Pick a template, fill in your details, and let Farah help sharpen the wording.
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(templates ?? []).map((t) => (
            <BorderedCard key={t.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[16px]">{t.name}</h3>
                  <span className="text-[12.5px] text-ink-soft">{t.industry_category}</span>
                </div>
                {t.is_premium && (
                  <span title="Needs credits" className="text-ink-soft">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                      <rect x="5" y="9" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                  </span>
                )}
              </div>
              {t.is_premium ? (
                <Button size="sm" variant="secondary" disabled title="Unlocks with credits (coming soon)">
                  Unlock with credits
                </Button>
              ) : (
                <form action={createResumeAction.bind(null, t.id)}>
                  <Button size="sm" type="submit">
                    Use this template
                  </Button>
                </form>
              )}
            </BorderedCard>
          ))}
        </div>
      </div>
    </div>
  );
}
