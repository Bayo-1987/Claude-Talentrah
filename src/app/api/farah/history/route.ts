import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { farahChatFreeMessagesRemaining } from "@/lib/farah/chat-gate";
import { hasActivePass } from "@/lib/passes/entitlement";

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

  /*
   * The panel's own "X free messages left" indicator (0123) — computed here
   * rather than a third round trip, since the panel already calls this
   * route once on mount. `null` when the user holds an active Pass: a Pass
   * covers messages regardless of the free counter, so surfacing "0 free
   * left" to someone with effectively unlimited messages would read as a
   * wall that isn't there. Not memoized (getActivePass is, deliberately —
   * see its own header) because this reads a live rolling count, not a
   * display-only summary.
   */
  const isPassHolder = await hasActivePass(user.id);
  const freeMessagesRemaining = isPassHolder ? null : await farahChatFreeMessagesRemaining(user.id);

  /*
   * The Farah-visibility design review's notification dot — wired to the
   * REAL "something new" signal 0131 already built for the proactive match
   * alert (user_notifications, owner-readable RLS, read_at owner-writable),
   * not a proxy invented for this. This route is the one round trip the
   * panel already makes on mount, so this rides along rather than adding a
   * second fetch.
   *
   * Marked read here, not left for a separate action: `read_at` exists
   * specifically for "the owner has seen this" (0131's own header — "only
   * read_at is owner-writable"), and this route runs exactly when that
   * becomes true — the panel carrying the mark is on screen. The RESPONSE
   * below still reports the pre-mark state, so the dot shows for this load;
   * the row is cleared for the next.
   */
  const { data: unread, error: unreadError } = await supabase
    .from("user_notifications")
    .select("id")
    .eq("user_id", user.id)
    .is("read_at", null);
  // Logged, not thrown: a rejected Supabase call resolves with an `error`
  // rather than throwing (CLAUDE.md's own standing rule, documented for
  // deletes but the same client behaviour applies here), so this is the
  // difference between a silent failure and a visible one. Low-severity
  // either way — a failed read just leaves the dot off this load, same as
  // genuinely having nothing unread — but silent is still wrong.
  if (unreadError) {
    console.error(`[farah-history] could not check unread notifications for ${user.id}: ${unreadError.message}`);
  }
  const hasUnreadNotification = (unread?.length ?? 0) > 0;
  if (hasUnreadNotification) {
    const { error: markReadError } = await supabase
      .from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    // Same reasoning as above, and lower-stakes than it looks: an unlogged
    // failure here would just mean the row stays unread and the same check
    // (and the same attempt to mark it read) runs again next page load —
    // not silent data loss, but still worth knowing about rather than
    // guessing at from a dot that never clears.
    if (markReadError) {
      console.error(`[farah-history] could not mark notifications read for ${user.id}: ${markReadError.message}`);
    }
  }

  // Newest-first out of the query (so the LIMIT takes the most recent turns),
  // oldest-first for the panel (so it reads top to bottom). Same two-step the
  // layout did.
  return NextResponse.json({
    messages: [...(data ?? [])].reverse(),
    freeMessagesRemaining,
    hasUnreadNotification,
  });
}
