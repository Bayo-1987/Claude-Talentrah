import { NextResponse } from "next/server";
import { inboxGate } from "@/lib/notifications/inbox/gate";
import { markAllRead } from "@/lib/notifications/inbox/service";

/** Mark every unread notification of the signed-in user read. Answers the unread count after the write. */
export async function POST() {
  const gate = await inboxGate();
  if (!gate.ok) return gate.response;
  const result = await markAllRead(gate.supabase, gate.user.id);
  if (!result.ok) return NextResponse.json({ error: "Couldn't update your notifications." }, { status: 500 });
  return NextResponse.json({ unreadCount: result.unreadCount }, { headers: { "Cache-Control": "no-store" } });
}
