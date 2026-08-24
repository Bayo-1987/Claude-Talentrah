"use server";

import { createClient } from "@/lib/supabase/server";

const VALID_CHANNELS = ["copy_link", "whatsapp", "email", "social"] as const;
type ShareChannel = (typeof VALID_CHANNELS)[number];

/**
 * Fire-and-forget engagement counter — the only honest way to show
 * "invites sent" on the dashboard, since none of this milestone's share
 * surfaces (copy link, WhatsApp, mailto, generic social) are a tracked
 * send-on-your-behalf flow (M8 spec §2/§4). Client-writable: carries no
 * monetary value, and RLS only lets a user write a row for themselves.
 */
export async function logShareAction(channel: string) {
  if (!VALID_CHANNELS.includes(channel as ShareChannel)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("referral_shares").insert({ user_id: user.id, channel });
}
