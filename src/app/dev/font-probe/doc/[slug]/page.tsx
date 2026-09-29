import { TemplateRenderer } from "@/components/resume-builder/templates";
import { EXAMPLE_PERSONAS } from "@/lib/resume-builder/preview-sample";

// THROWAWAY DIAGNOSTIC (send-473) — never merged. Any registered template, real prose.
export default async function DocProbe({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TemplateRenderer slug={slug} resume={EXAMPLE_PERSONAS[0]} />;
}
