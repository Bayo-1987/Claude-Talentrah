import { NextResponse } from "next/server";
import { inboxGate } from "@/lib/notifications/inbox/gate";
import { markOneRead } from "@/lib/notifications/inbox/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Mark ONE of the signed-in user's notifications read (the one being opened). Answers the unread count after the write. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await inboxGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not a notification." }, { status: 400 });
  const result = await markOneRead(gate.supabase, gate.user.id, id);
  if (!result.ok) return NextResponse.json({ error: "Couldn't update your notifications." }, { status: 500 });
  return NextResponse.json({ unreadCount: result.unreadCount }, { headers: { "Cache-Control": "no-store" } });
}
