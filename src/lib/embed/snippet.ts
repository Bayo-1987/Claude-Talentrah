import { isUuid } from "./widget-html";

/** The embed page's absolute URL. Throws for anything that is not an organisation id, so a URL is never built from free text. */
export function embedUrl(organizationId: string, origin: string): string {
  if (!isUuid(organizationId)) throw new Error("embedUrl: not an organisation id");
  return `${origin.replace(/\/+$/, "")}/embed/jobs/${organizationId}`;
}

/** The height of the frame in the snippet, in pixels. The Company Profile card quotes the same number, so the two cannot disagree. */
export const EMBED_FRAME_HEIGHT = 480;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escAttr = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** The `<iframe>` an employer pastes into their own website. The company name goes into the title attribute (for screen readers), escaped. */
export function iframeSnippet(args: { organizationId: string; companyName: string; origin: string }): string {
  const src = embedUrl(args.organizationId, args.origin);
  return `<iframe src="${src}" title="Jobs at ${escAttr(args.companyName)}" width="100%" height="${EMBED_FRAME_HEIGHT}" style="border:0" loading="lazy"></iframe>`;
}
