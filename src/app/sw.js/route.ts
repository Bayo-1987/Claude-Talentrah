import { KILL_SOURCE, WORKER_SOURCE } from "@/lib/pwa/service-worker-source";

/**
 * /sw.js: the service worker, served by a route handler (not a file in public/) so it can carry its own headers and the kill switch.
 *
 * DYNAMIC on purpose: PWA_KILL is read when the browser fetches the worker, so a browser doing its background update check gets the
 * self-destruct worker as soon as the deployment serves it. (The root layout reads the same variable for the page side; see
 * src/components/pwa/pwa-bootstrap.tsx. Changing it needs a redeploy; docs/pwa.md says where to set it.)
 *
 * Headers are the three Next's own PWA guide lists for a worker: JavaScript, never cached (so an update reaches people on their next load, with
 * `updateViaCache: "none"` at registration), and a CSP of its own. The global header rule in next.config.ts still adds HSTS and nosniff.
 * Registration sets no cookie and neither does this route.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const body = process.env.PWA_KILL === "1" ? KILL_SOURCE : WORKER_SOURCE;
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
    },
  });
}
