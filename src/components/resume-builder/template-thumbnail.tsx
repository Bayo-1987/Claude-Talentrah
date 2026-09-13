"use client";

import { TemplateRenderer, registeredSlugs } from "@/components/resume-builder/templates";
import { personaForSlug } from "@/lib/resume-builder/persona-for-slug";

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
 * TEMPLATE LIBRARY PR3: every catalog slug now has a real component —
 * structured-admin, product-tech, field-notes and ledger (PR2's "known free
 * exceptions" with no layout of their own) are skeleton-configured like every
 * other PR3 row, and `KNOWN_UNSTYLED_FREE_SLUGS` in
 * template-registry.test.ts is empty. An unmapped/unknown slug still falls
 * back to the default via the registry's documented fallback, so this
 * component's thumbnail always honestly shows what a visitor will get even if
 * that ever regresses.
 *
 * SIZE (Stage 3.2). With only eleven templates in the catalog, this gallery
 * doesn't need Canva's thumbnail-at-scale density — it can afford to let a
 * user actually read what they're choosing between. THUMB_HEIGHT and SCALE
 * were raised together (190→420, 0.26→0.5) so the card shows a real, legible
 * slice of the document instead of a postage stamp; the gallery dropped to
 * two columns at the same time (see the grid in resume-builder/page.tsx) so
 * the wider card has room to hold it. Centered on the horizontal axis
 * (`left-1/2` + a `translateX(-50%)` folded into the same inline
 * `transform` as the scale, since a second transform source — a Tailwind
 * translate class — would just be silently overridden by the inline style)
 * so a column narrower than the rendered width — a phone, mainly — crops
 * evenly off both sides rather than only the right.
 */
const NATURAL_WIDTH = 820;
const THUMB_HEIGHT = 420;
const SCALE = 0.5;

export function TemplateThumbnail({ slug }: { slug: string | null }) {
  const registered = slug ? registeredSlugs().includes(slug) : false;
  // The persona matching THIS template's own slug (blueprint's civil
  // engineer, site-report's foreman, field-mission's programme officer,
  // etc.) — see persona-for-slug.ts. A slug with no dedicated persona falls
  // back to the same PM persona every card previewed before this mechanism
  // existed.
  const resume = personaForSlug(slug);

  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden border border-line bg-card"
      style={{ height: THUMB_HEIGHT }}
    >
      <div
        className="pointer-events-none absolute top-0 left-1/2 origin-top"
        style={{ width: NATURAL_WIDTH, transform: `translateX(-50%) scale(${SCALE})` }}
      >
        <TemplateRenderer slug={slug} resume={resume} />
      </div>

      {/*
        Said on the thumbnail itself rather than left to be discovered after
        choosing. These four are catalogued templates with no distinct layout
        yet; the preview above is accurate — it is the default — and the label
        stops it reading as a rendering bug.
      */}
      {!registered && (
        <span className="absolute right-0 bottom-0 bg-ink px-2 py-0.5 font-body text-[10px] font-bold tracking-[0.1em] text-bg uppercase">
          Standard layout
        </span>
      )}
    </div>
  );
}
