/**
 * The cookie's name and scope, and nothing else.
 *
 * Split out from session.ts because src/proxy.ts needs the name and must not
 * pull in what session.ts imports — `server-only`, `next/headers`, node:crypto
 * and the service-role client have no business in the proxy bundle, and one of
 * them would fail to build there.
 *
 * PATH IS /admin, deliberately. The browser never sends this cookie to the
 * seeker app, to /api/*, or anywhere else on the origin, so a logging or XSS
 * mistake outside the admin area cannot capture it in a request it happens to
 * observe.
 *
 * The cost is real and worth stating rather than discovering: a future
 * `/api/admin/*` route CANNOT read this cookie. M2's screens are Server
 * Actions, which post back to the /admin URL they were rendered from, so they
 * are fine. Widening the path is the deliberate change to make if an admin API
 * route ever needs it.
 */
export const ADMIN_COOKIE = "talentrah_admin_session";
export const ADMIN_COOKIE_PATH = "/admin";
