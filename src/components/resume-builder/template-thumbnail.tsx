"use client";

import { TemplateRenderer, registeredSlugs } from "@/components/resume-builder/templates";
import { PREVIEW_SAMPLE_RESUME } from "@/lib/resume-builder/preview-sample";

/**
 * A live, scaled-down render of the actual template.
 *
 * NOT AN IMAGE. `resume_templates.preview_asset_url` exists and is null on all
 * 11 rows, read by nothing — it is left dead on purpose. Static thumbnails
 * would have to be produced and re-produced by hand every time a layout
 * changed, and the failure mode is silent: the picture keeps advertising the
 * old design and nobody notices until a user picks a template and gets
 * something else. Rendering the real component cannot drift from what it is
 * selling.
 *
 * HOW THE SCALING WORKS. The template is rendered at its natural width inside
 * a clipped box and shrunk with a CSS transform. Not `zoom` (non-standard, and
 * Firefox only grew support recently) and not a re-styled miniature copy of
 * each template, which would be seven more things to keep in sync and would
 * reintroduce exactly the drift this avoids.
 *
 * `pointer-events-none` and `aria-hidden` because it is a picture of a
 * document, not a document: nothing inside should be tabbable, and a screen
 * reader announcing an entire fake resume before every card would bury the
 * template's name in noise. The card's own heading carries the accessible
 * name.
 *
 * FOUR SLUGS RENDER THE DEFAULT LAYOUT — structured-admin, product-tech,
 * field-notes, ledger. That is correct, not a gap to paper over:
 * template-registry.test.ts lists them as known free exceptions with no
 * component of their own, and the registry's documented fallback is what
 * catches them. Their thumbnails honestly show what a visitor will get.
 */
const NATURAL_WIDTH = 820;
const THUMB_HEIGHT = 190;
const SCALE = 0.26;

export function TemplateThumbnail({ slug }: { slug: string | null }) {
  const registered = slug ? registeredSlugs().includes(slug) : false;

  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden border border-line bg-card"
      style={{ height: THUMB_HEIGHT }}
    >
      <div
        className="pointer-events-none absolute top-0 left-0 origin-top-left"
        style={{ width: NATURAL_WIDTH, transform: `scale(${SCALE})` }}
      >
        <TemplateRenderer slug={slug} resume={PREVIEW_SAMPLE_RESUME} />
      </div>

      {/*
        Said on the thumbnail itself rather than left to be discovered after
        choosing. These four are catalogued templates with no distinct layout
        yet; the preview above is accurate — it is the default — and the label
        stops it reading as a rendering bug.
      */}
      {!registered && (
        <span className="absolute right-0 bottom-0 bg-ink px-2 py-0.5 font-body text-[10px] font-bold tracking-[0.1em] text-paper uppercase">
          Standard layout
        </span>
      )}
    </div>
  );
}
