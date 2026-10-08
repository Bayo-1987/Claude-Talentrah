/**
 * The server-side switch for the employer job-list widget (owner condition, 8 Oct 2026).
 *
 * The widget is OFF for every employer until the owner has put a Vercel Firewall rate-limit rule on /embed/*, and the owner turns it on by setting EMBED_WIDGET_ENABLED=1 in the deployment.
 * While it is unset: the Company Profile card says "not available yet" and offers nothing to act on, the settings action refuses to switch a widget on, and /embed/jobs/<id> answers the
 * identical neutral page for every organisation without touching the database.
 *
 * Only the exact value "1" turns it on, so a stray "true", "yes" or empty value cannot. This is an ENVIRONMENT read at call time, not request state (no cookies, headers or URL), so the
 * embed route stays statically cacheable. (A page generated while the switch was off is served from the cache until it expires or is purged, at most 30 minutes; a deployment change
 * starts with a fresh cache.)
 */
export function embedWidgetEnabled(): boolean {
  return process.env.EMBED_WIDGET_ENABLED === "1";
}
