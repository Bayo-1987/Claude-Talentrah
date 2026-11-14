import "server-only";
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/flags/read";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { createClient } from "@/lib/supabase/server";

/**
 * The shared front of every inbox route. Order matters: the notifications_master flag is read FIRST, through the existing server flag reader (it fails closed: a missing row or a read error is OFF), and OFF answers
 * 404 before the session is looked at and before user_notifications is touched. Then the session (401 when signed out). Returns the session client and user, or the response to send.
 */
export type InboxGate = { ok: false; response: NextResponse } | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string } };

export async function inboxGate(): Promise<InboxGate> {
  if (!(await isFeatureEnabled(NOTIFICATION_FLAGS.master))) {
    return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  return { ok: true, supabase, user };
}
