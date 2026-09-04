import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Farah's recent conversation, fetched by the panel itself.
 *
 * ── WHY THIS ROUTE EXISTS ─────────────────────────────────────────────────
 *
 * (app)/layout.tsx used to load this. The layout wraps EVERY page in the
 * signed-in app, so a `farah_messages` read — plus a second Supabase client
 * built solely to make it — was on the critical path of the job feed, the
 * tracker, billing, settings and everything else, whether or not the reader
 * ever said a word to Farah. Production holds 43 Farah messages across 40
 * accounts, so for almost every page load it was a round trip that returned
 * nothing and delayed the whole document while doing it.
 *
 * Moving it here makes it a request the panel starts after the page is
 * already on screen: it cannot delay first paint, and it costs nothing on
 * the server render.
 *
 * ── SCOPING ───────────────────────────────────────────────────────────────
 *
 * The user's OWN messages only. `.eq("user_id", user.id)` is belt-and-braces
 * on top of `farah_messages`' owner-only RLS policy, which is what actually
 * enforces it — this client is the session-scoped one (RLS applies), not the
 * service role. 401 rather than an empty list when signed out, so a
 * misbehaving caller gets an error instead of a plausible-looking nothing.
 */

/** Matches the limit the layout used, so the panel shows what it always did. */
const HISTORY_LIMIT = 20;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("farah_messages")
    .select("id, role, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    return NextResponse.json({ error: "Couldn't load your conversation." }, { status: 500 });
  }

  // Newest-first out of the query (so the LIMIT takes the most recent turns),
  // oldest-first for the panel (so it reads top to bottom). Same two-step the
  // layout did.
  return NextResponse.json({ messages: [...(data ?? [])].reverse() });
}
