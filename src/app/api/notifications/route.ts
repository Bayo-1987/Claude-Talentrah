import { NextResponse } from "next/server";
import { inboxGate } from "@/lib/notifications/inbox/gate";
import { listInbox } from "@/lib/notifications/inbox/service";

/** The signed-in user's newest 20 notifications and their unread count (notifications_master must be on; session client only). */
export async function GET() {
  const gate = await inboxGate();
  if (!gate.ok) return gate.response;
  const inbox = await listInbox(gate.supabase, gate.user.id);
  if (!inbox) return NextResponse.json({ error: "Couldn't load your notifications." }, { status: 500 });
  return NextResponse.json(inbox, { headers: { "Cache-Control": "no-store" } });
}
