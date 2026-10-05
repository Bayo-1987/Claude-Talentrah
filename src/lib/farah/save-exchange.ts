import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/lib/supabase/types";

/**
 * Saves one Farah exchange (the user's message and Farah's reply). Message history is written by the server only, so this uses the
 * service-role client; the caller has already established `userId` from the session. It lives in its own module so the chat route,
 * which reads job postings through the signed-in session's client (RLS decides what that user may see), never holds a service-role
 * client itself.
 *
 * Returns the reply row's id and timestamp, or null when either write failed. A failure logs error codes only: never the message
 * text or the reply.
 */
export async function saveFarahExchange(params: {
  userId: string;
  message: string;
  reply: string;
  userRowContext: Json;
  replyRowContext: Json;
}): Promise<{ id: string; createdAt: string } | null> {
  const history = createServiceRoleClient();
  // Two independent writes (different rows, neither reads the other) — run together rather than one after the other.
  const [{ error: userRowError }, { data: replyRow, error: replyRowError }] = await Promise.all([
    history.from("farah_messages").insert({ user_id: params.userId, role: "user", content: params.message, context: params.userRowContext }),
    history
      .from("farah_messages")
      .insert({ user_id: params.userId, role: "farah", content: params.reply, context: params.replyRowContext })
      .select("id, created_at")
      .single(),
  ]);
  if (userRowError || replyRowError || !replyRow) {
    console.error("Farah chat: saving the exchange failed", { userRowCode: userRowError?.code ?? null, replyRowCode: replyRowError?.code ?? null });
    return null;
  }
  return { id: replyRow.id, createdAt: replyRow.created_at };
}
