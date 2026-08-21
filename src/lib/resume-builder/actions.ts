"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { rewriteBullet, type BulletInstruction } from "@/lib/farah/rewrite-bullet";

async function getAuthedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

export async function createResumeAction(templateId: string) {
  const { supabase, userId } = await getAuthedUserId();

  const { data: template } = await supabase
    .from("resume_templates")
    .select("id, is_premium, name")
    .eq("id", templateId)
    .single();

  if (!template) throw new Error("Template not found.");
  if (template.is_premium) {
    // Credits/passes land in M5 — premium templates aren't purchasable yet.
    throw new Error("This template needs credits, which aren't available yet.");
  }

  const { data: resume, error } = await supabase
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: false,
      template_id: template.id,
      title: template.name,
      source: "builder",
      structured_content: JSON.parse(JSON.stringify(EMPTY_RESUME)),
    })
    .select("id")
    .single();

  if (error || !resume) throw error ?? new Error("Couldn't create resume.");

  redirect(`/resume-builder/edit?resumeId=${resume.id}`);
}

export async function saveResumeAction(
  resumeId: string,
  content: StructuredResume,
  title: string,
) {
  const { supabase, userId } = await getAuthedUserId();

  const { error } = await supabase
    .from("resumes")
    .update({
      title,
      structured_content: JSON.parse(JSON.stringify(content)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) throw error;
  revalidatePath("/resume-builder");
  revalidatePath(`/resume-builder/preview`);
}

export async function rewriteBulletAction(text: string, instruction: BulletInstruction) {
  if (!text.trim()) return text;
  return rewriteBullet(text, instruction);
}

export async function deleteResumeAction(resumeId: string) {
  const { supabase, userId } = await getAuthedUserId();
  await supabase.from("resumes").delete().eq("id", resumeId).eq("user_id", userId).eq("is_base", false);
  revalidatePath("/resume-builder");
}
