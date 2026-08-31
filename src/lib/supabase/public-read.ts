import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * An anon-key client with no request attached.
 *
 * ── WHY THIS IS NEEDED AT ALL ─────────────────────────────────────────────
 *
 * `lib/supabase/server.ts` reads `cookies()`, which makes it unusable in two
 * real places: `generateStaticParams`, which runs at build time with no HTTP
 * request, and any route we want statically prerendered — a route that touches
 * cookies is dynamic by definition.
 *
 * Moving the blog into the database hit both at once. The build failed with
 * "used `cookies()` inside `generateStaticParams`", and had it not failed, the
 * blog would have quietly stopped being prerendered.
 *
 * ── WHY ANON AND NOT SERVICE ROLE ─────────────────────────────────────────
 *
 * The service-role client is right there and would also work, and using it
 * would be a mistake worth naming: it BYPASSES RLS. The blog's guarantee —
 * drafts are unreadable by any public path — is an RLS policy, so reading
 * public content through a client that ignores policies means the guarantee
 * holds only as long as every query remembers `.eq("status", "published")`.
 *
 * With the anon key the policy is doing the work. A query here that forgot the
 * filter would still return only published rows, because that is what anon is
 * permitted to see. That is the difference between a guarantee and a
 * convention.
 *
 * NEVER use this for anything owner-scoped. It has no session, so it is not
 * "the current user" — it is the public.
 */
export function createPublicReadClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
