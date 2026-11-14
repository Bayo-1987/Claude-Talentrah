import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { safeInternalPath } from "@/lib/notifications/inbox/links";

/**
 * The inbox over `user_notifications`, through the SIGNED-IN USER's own client (RLS: owner-readable, and read_at is the only column the owner may write). Never the service role, never the unread-count RPC
 * (service-role only): the count is a plain count of the user's unread rows. Every query names the user id as well, belt and braces on top of RLS.
 *
 * While the inbox is ON this file is the ONLY writer of read_at in src/. The one other writer is the Farah history route's flag-OFF branch (no bell exists then); tests/notifications/inbox-scan.test.ts pins both. Each writer returns the unread count AFTER the write, so the bell and the app badge (NOTIF-BADGE-CALLERS-1)
 * can show one number.
 */
type Db = Pick<SupabaseClient<Database>, "from">;

export const INBOX_LIMIT = 20;

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  /** A same-origin path, or null. */
  link: string | null;
  createdAt: string;
  read: boolean;
}

/** The number of unread rows, or null when it could not be read (never 0 for "unknown"). */
export async function countUnread(db: Db, userId: string): Promise<number | null> {
  const { count, error } = await db.from("user_notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
  if (error) {
    console.error(`[notifications] could not count unread notifications for ${userId}: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

/** The newest 20 items and the unread count, or null when the list could not be read. */
export async function listInbox(db: Db, userId: string): Promise<{ items: InboxItem[]; unreadCount: number | null } | null> {
  const { data, error } = await db
    .from("user_notifications")
    .select("id, type, title, body, link, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(INBOX_LIMIT);
  if (error) {
    console.error(`[notifications] could not list notifications for ${userId}: ${error.message}`);
    return null;
  }
  const items = (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: safeInternalPath(row.link),
    createdAt: row.created_at,
    read: row.read_at !== null,
  }));
  return { items, unreadCount: await countUnread(db, userId) };
}

export type MarkResult = { ok: true; unreadCount: number | null } | { ok: false };

/** Marks ONE of this user's notifications read (only if it is still unread). */
export async function markOneRead(db: Db, userId: string, id: string): Promise<MarkResult> {
  const { error } = await db
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) {
    console.error(`[notifications] could not mark a notification read for ${userId}: ${error.message}`);
    return { ok: false };
  }
  return { ok: true, unreadCount: await countUnread(db, userId) };
}

/** Marks every unread notification of this user read. */
export async function markAllRead(db: Db, userId: string): Promise<MarkResult> {
  const { error } = await db.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null).select("id");
  if (error) {
    console.error(`[notifications] could not mark notifications read for ${userId}: ${error.message}`);
    return { ok: false };
  }
  return { ok: true, unreadCount: await countUnread(db, userId) };
}
