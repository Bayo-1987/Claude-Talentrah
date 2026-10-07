import { fetchWidgetPayload } from "@/lib/embed/widget-data";
import { isUuid, renderWidgetHtml } from "@/lib/embed/widget-html";

/**
 * GET /embed/jobs/<organisation id>: the employer job-list widget, an HTML document for an iframe on the employer's own website (plan v2.1, owner-approved 7 Oct 2026).
 *
 * A route handler on purpose, not a page: it must not sit under the root layout (Analytics, Speed Insights and the cookie banner do not belong in a third-party frame), and it
 * returns a complete document with no script. It reads NO request state, no cookies, no headers, no query string, no session, which is what lets it be statically cached
 * per organisation: the first request for an organisation builds the page, `revalidate` keeps it for 30 minutes, and `revalidateEmbed(organizationId)` (src/lib/embed/revalidate.ts)
 * purges it the moment a posting or the organisation changes. A query string is ignored (the cached page is the same for every query), not redirected, because reading the
 * URL would make the route dynamic. tests/embed/embed-route-source.test.ts pins all of this.
 *
 * Headers: the framing headers for this path are set in next.config.ts (/embed/:path+), pinned by tests/embed/embed-headers.test.ts.
 */
export const revalidate = 1800;

/** Nothing is prebuilt: an organisation's page is generated on its first request (dynamicParams stays on). */
export async function generateStaticParams(): Promise<Array<{ orgId: string }>> {
  return [];
}

const HTML = { "Content-Type": "text/html; charset=utf-8" };

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  // A malformed id is answered before any database call, with the same neutral page.
  if (!isUuid(orgId)) return new Response(renderWidgetHtml(null), { status: 404, headers: HTML });
  const data = await fetchWidgetPayload(orgId);
  return new Response(renderWidgetHtml(data), { status: 200, headers: HTML });
}
