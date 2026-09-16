import { AppShell } from "@/components/app-shell/app-shell";

/**
 * The public, existence-gated pages — job/scholarship detail pages and the
 * programmatic SEO landing pages (city/remote/degree/fully-funded), the only
 * routes in this whole area a signed-out visitor reaches directly. Renders
 * the identical shell (app)/layout.tsx does (masthead when signed in, the
 * marketing masthead + GoogleOneTap branch when not) via the SAME AppShell
 * component, so there is exactly one place that logic lives — see
 * AppShell's own comment.
 *
 * WHY A SEPARATE ROUTE GROUP, NOT JUST A LOOSE EXCEPTION UNDER (app):
 * every route here calls `notFound()` (a missing job/scholarship, a
 * below-threshold landing page), and Next.js commits an HTTP response to 200
 * the instant ANY `loading.tsx` exists anywhere in a route's ancestor chain —
 * before that `notFound()` can run. (app)/loading.tsx (this same restoration)
 * would break every one of these otherwise. `(public)` is a route group: it
 * changes nothing about the URL (`/jobs/[id]` still resolves to `/jobs/<id>`,
 * the same reason `(app)` itself never appears in a URL either), but it is a
 * SIBLING of `(app)` in the segment tree, not a descendant — so it shares no
 * ancestor loading.tsx with it. Same pattern #430 used for jobs/(feed) vs.
 * jobs/[id], one level up: a whole top-level group instead of a nested one,
 * because this time the routes needing the exemption are scattered across
 * `jobs/` AND `scholarships/`, not confined to one parent.
 *
 * DELIBERATELY NEVER GETS ITS OWN loading.tsx. Adding one here — even a
 * narrowly-scoped one — reintroduces exactly the bug this group exists to
 * avoid. If a future perceived-latency complaint targets one of these pages,
 * the fix is a client-side pending-state mechanism local to that page (the
 * same shape jobs/(feed)'s FeedTabs uses for its tab clicks), not a
 * loading.tsx anywhere in this tree.
 *
 * NOT EVERY notFound()-CAPABLE PUBLIC ROUTE LIVES HERE. `mentorship/[mentorId]`
 * also calls `notFound()` for a nonexistent mentor, but it gates itself with a
 * PAGE-LEVEL `requireUser()` call rather than through `seekerAppGate` — so a
 * signed-out visitor is redirected, not shown the page, and it isn't
 * genuinely public the way these routes are. Moving it here would misrepresent
 * it, and fixing its auth mechanism means touching `seekerAppGate`, which is
 * out of scope for this change. It keeps inheriting the restored
 * (app)/loading.tsx and will regress the same way #221 originally found —
 * a known, deliberately unaddressed gap, not an oversight; see this repo's own
 * PR history for the restoration this file is part of.
 */
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
