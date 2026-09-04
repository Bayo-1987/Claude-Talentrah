import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { StartStateChooser } from "@/components/resume-builder/start-state-chooser";

export const metadata = { title: "New resume — Talentrah" };

/**
 * The three-state chooser (Stage 3.1) sits HERE — a new step between picking
 * a template on the gallery (/resume-builder) and createResumeAction actually
 * inserting a `resumes` row. TemplateCard's "Use this template" link now
 * points here instead of submitting the create form directly; this page
 * fetches what the chooser needs to render (whether the user has a base
 * resume to offer as a one-click import) and the chooser's three panels each
 * submit a real form bound to createResumeAction with a different start
 * state, per that action's own doc comment.
 *
 * The premium-unlock check this redirect performs is a UX nicety, not the
 * security boundary — createResumeAction re-checks the unlock server-side
 * regardless of how a request reaches it, exactly as it did before this page
 * existed. This just avoids showing the chooser for a template the user
 * can't actually use yet.
 */
export default async function NewResumePage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string }>;
}) {
  const { user } = await requireUser();
  const { templateId } = await searchParams;
  if (!templateId) redirect("/resume-builder");

  const supabase = await createClient();
  const [{ data: template }, { data: baseResume }] = await Promise.all([
    supabase
      .from("resume_templates")
      .select("id, name, is_premium")
      .eq("id", templateId)
      .maybeSingle(),
    supabase
      .from("resumes")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_base", true)
      .maybeSingle(),
  ]);

  if (!template) redirect("/resume-builder");

  if (template.is_premium) {
    const { data: unlock } = await supabase
      .from("user_template_unlocks")
      .select("id")
      .eq("user_id", user.id)
      .eq("template_id", template.id)
      .maybeSingle();
    if (!unlock) redirect("/resume-builder");
  }

  return (
    <StartStateChooser
      templateId={template.id}
      templateName={template.name}
      hasBaseResume={!!baseResume}
    />
  );
}
