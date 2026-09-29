import { TemplateRenderer } from "@/components/resume-builder/templates";
import { EXAMPLE_PERSONAS } from "@/lib/resume-builder/preview-sample";
import { poppins, workSans, lora, barlowCondensed } from "@/components/resume-builder/skeletons/fonts";
import { resumeSourceSans } from "@/components/resume-builder/templates/fonts";

// THROWAWAY DIAGNOSTIC (send-473) — never merged. Any registered template, real prose,
// with every app font variable in scope so a font-family override can reach any face.
export default async function DocProbe({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const scope = [resumeSourceSans.variable, workSans.variable, poppins.variable, lora.variable, barlowCondensed.variable].join(" ");
  return (
    <div className={scope}>
      <TemplateRenderer slug={slug} resume={EXAMPLE_PERSONAS[0]} />
    </div>
  );
}
