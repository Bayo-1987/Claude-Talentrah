"use server";

import { createClient } from "@/lib/supabase/server";

const VALID_CHANNELS = ["copy_link", "whatsapp", "email", "social"] as const;
type ShareChannel = (typeof VALID_CHANNELS)[number];

const VALID_SURFACES = ["refer", "scholarship"] as const;
type ShareSurface = (typeof VALID_SURFACES)[number];

/**
 * Fire-and-forget engagement counter — the only honest way to show
 * "invites sent" on the dashboard, since none of this milestone's share
 * surfaces (copy link, WhatsApp, mailto, generic social) are a tracked
 * send-on-your-behalf flow (M8 spec §2/§4). Client-writable: carries no
 * monetary value, and RLS only lets a user write a row for themselves.
 *
 * `surface` defaults to "refer" so every existing caller — `onShare=
 * {logShareAction}` passed straight through as a one-argument callback on
 * /refer and the tracker's hired banner — keeps recording exactly what it
 * always has, with no call-site change. A scholarship card's share button is
 * the one caller that passes "scholarship" explicitly (see migration 0099
 * for why the column exists at all: without it, a scholarship share would
 * silently inflate the same "invites sent" number /refer's funnel is
 * measured on).
 */
export async function logShareAction(channel: string, surface: string = "refer") {
  if (!VALID_CHANNELS.includes(channel as ShareChannel)) return;
  if (!VALID_SURFACES.includes(surface as ShareSurface)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("referral_shares").insert({ user_id: user.id, channel, surface });
}
