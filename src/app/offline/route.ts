import { OFFLINE_PAGE_HTML } from "@/lib/pwa/offline-page";

/**
 * /offline: the page the service worker answers with when a navigation cannot reach the network (src/lib/pwa/offline-page.ts says why it is a
 * route handler returning a string and not a page).
 *
 * `X-Robots-Tag: noindex` keeps it out of search; it is also absent from the sitemap. Cache-Control is left to Next's default for a static
 * route handler: nothing here is private, and the worker stores its own copy at install.
 *
 * `force-static`: a GET route handler is dynamic by default since Next 15 (the build listed this as a function until this line), so without it every
 * offline-page fetch, including the worker's install-time fetch, would be a function invocation. It reads no request-time API, so it prerenders. It is excluded from the proxy (src/proxy.ts), so it is
 * answered the same for everyone, including a signed-in person inside their deletion window.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(OFFLINE_PAGE_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
