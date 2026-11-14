import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { farahChatFreeMessagesRemaining, farahChatNextFreeMessageAt } from "@/lib/farah/chat-gate";
import { hasActivePass } from "@/lib/passes/entitlement";
import { inboxEnabled } from "@/lib/notifications/inbox/enabled";

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
   * When the next free message comes back (an ISO time), for the panel's "next one on ..." line. Only when the free messages are USED UP and no Pass is active: in every other case it is null
   * and the read is not made. It is display-only, so any failure of the read is null and never changes or blocks the rest of this response.
   */
  let nextFreeMessageAt: string | null = null;
  if (!isPassHolder && freeMessagesRemaining === 0) {
    try {
      nextFreeMessageAt = await farahChatNextFreeMessageAt(user.id);
    } catch {
      nextFreeMessageAt = null;
    }
  }

  /*
   * The Farah-visibility design review's notification dot — wired to the REAL "something new" signal 0131 already built for the proactive match alert (user_notifications, owner-readable RLS), not a proxy
   * invented for this. This route is the one round trip the panel already makes on mount, so this rides along rather than adding a second fetch.
   *
   * WHO CLEARS THE DOT depends on the inbox flag (NOTIF-FARAH-HISTORY-1):
   *  - notifications_master OFF (no bell exists): this route is the only place an unread notification is seen, so it marks them read here, as it always did — `read_at` exists for "the owner has seen this", and this
   *    route runs exactly when that becomes true. The RESPONSE reports the pre-mark state, so the dot shows for this load and the rows are cleared for the next. Without this the dot would never clear.
   *  - notifications_master ON: the bell owns read state (src/lib/notifications/inbox/service.ts). Opening Farah must not clear the unread items of a person who never opened the bell, so this route only reports
   *    whether something is unread, and says the same on the next call.
   * The flag read fails closed (OFF), which keeps the old behaviour: a broken flag read can never leave the dot stuck.
   */
  const bellOwnsReadState = await inboxEnabled();
  const { data: unread, error: unreadError } = await supabase.from("user_notifications").select("id").eq("user_id", user.id).is("read_at", null).limit(1);
  // Logged, not thrown: a rejected Supabase call resolves with an `error` rather than throwing (CLAUDE.md's standing rule), so this is the difference between a silent failure and a visible one. Low-severity
  // either way — a failed read just leaves the dot off this load, same as genuinely having nothing unread — but silent is still wrong.
  if (unreadError) {
    console.error(`[farah-history] could not check unread notifications for ${user.id}: ${unreadError.message}`);
  }
  const hasUnreadNotification = (unread?.length ?? 0) > 0;
  if (hasUnreadNotification && !bellOwnsReadState) {
    const { error: markReadError } = await supabase
      .from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    // An unlogged failure here would just mean the row stays unread and the same check (and the same attempt) runs again next page load — not silent data loss, but still worth knowing about.
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
    nextFreeMessageAt,
    hasUnreadNotification,
  });
}
