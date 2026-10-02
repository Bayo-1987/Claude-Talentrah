import { absoluteUrl } from "@/lib/seo/site";

/**
 * schema.org BreadcrumbList for a page's trail (send-509, S3-21c / P10).
 *
 * BREADCRUMB ONLY, on purpose. Google's structured-data gallery has no scholarship rich result (checked 2026-09-01, recorded in
 * docs/scholarship-sources.md), and schema.org's MonetaryGrant is a core type without a deadline property, so a grant block would claim
 * nothing a crawler could verify. Breadcrumb is a supported rich result and everything in it is already on the page.
 *
 * Returns null, like every builder in lib/seo, rather than markup it cannot stand behind: fewer than two crumbs, a blank name, or a path that
 * is not site-absolute ("/…"). Every `item` is an absolute URL, as Google's Breadcrumb documentation requires.
 */
export interface Crumb {
  name: string;
  /** Site-absolute path, starting with "/". */
  path: string;
}

export function buildBreadcrumbJsonLd(trail: Crumb[]): Record<string, unknown> | null {
  if (trail.length < 2) return null;
  for (const crumb of trail) {
    if (!crumb.name.trim() || !crumb.path.startsWith("/")) return null;
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name.trim(),
      item: absoluteUrl(crumb.path),
    })),
  };
}
