/**
 * A session's other party's name was invisible to both sides (0168, found
 * while investigating 0167's identical shape of bug for mentor listings).
 * loadSessions() (src/lib/mentorship/queries.ts) fetched both parties'
 * names via a `profiles` lookup through the authenticated client — but
 * `profiles` carries only two self-scoped RLS policies, so the lookup only
 * ever returned the CALLER's own row. A mentee viewing their own booked
 * session (/mentorship/sessions) saw the generic "Mentor" fallback instead
 * of the mentor's real name; a mentor viewing theirs
 * (/mentorship/sessions/mentor) saw "Mentee" instead of the mentee's real
 * name. Confirmed live with a real booked session before fixing.
 *
 * Fixed via mentorship_session_counterparty_names(), a narrow SECURITY
 * DEFINER function scoped to auth.uid() — NOT mentor_public_names() reused,
 * since a session counterparty isn't public the way an approved mentor's
 * listing is; see that function's own migration comment (0168) for why the
 * eligibility gate has to be shaped differently.
 *
 * Proven to catch the regression before being trusted: reverting
 * loadSessions() to the pre-fix plain `profiles` select made both
 * assertions below fail exactly where expected (the real names never
 * appear, the generic fallbacks do) — not a superficial pass.
 *
 * Two independent signed-in browser contexts (mentor, then mentee), same
 * reason mentor-public-name.spec.ts uses two rather than the shared
 * `authed` fixture, which only ever gives one authenticated context.
 */
import { test as base, expect } from "@playwright/test";
import { admin } from "./fixtures/authed";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SessionCookie {
  name: string;
  value: string;
}

async function mintSessionCookie(email: string): Promise<SessionCookie> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const jar = new Map<string, string>();
  const captured: SessionCookie[] = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          jar.set(c.name, c.value);
          captured.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error: otpErr } = await ssr.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
  if (!captured.length) throw new Error("no session cookie produced");
  return captured[0];
}

base("a booked session's other party's real name is visible to both sides", async ({
  browser,
  baseURL,
}) => {
  base.setTimeout(60_000);
  const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
  const mentorEmail = `mentor-${randomUUID()}@${domain}`;
  const menteeEmail = `mentee-${randomUUID()}@${domain}`;

  const { data: mentorUser, error: mErr } = await admin.auth.admin.createUser({
    email: mentorEmail,
    email_confirm: true,
  });
  if (mErr) throw mErr;
  const { data: menteeUser, error: eErr } = await admin.auth.admin.createUser({
    email: menteeEmail,
    email_confirm: true,
  });
  if (eErr) throw eErr;

  try {
    const { error: mentorNameErr } = await admin
      .from("profiles")
      .update({ first_name: "Mentor", last_name: "RealName" })
      .eq("id", mentorUser.user.id);
    if (mentorNameErr) throw mentorNameErr;
    const { error: menteeNameErr } = await admin
      .from("profiles")
      .update({ first_name: "Mentee", last_name: "RealName" })
      .eq("id", menteeUser.user.id);
    if (menteeNameErr) throw menteeNameErr;

    const { error: mpErr } = await admin
      .from("mentor_profiles")
      .insert({ user_id: mentorUser.user.id, status: "approved", bio: "e2e test mentor" });
    if (mpErr) throw mpErr;

    const start = new Date(Date.now() - 3600_000).toISOString();
    const end = new Date(Date.now() - 1800_000).toISOString();
    const { data: slot, error: slotErr } = await admin
      .from("mentor_availability_slots")
      .insert({ mentor_id: mentorUser.user.id, start_at: start, end_at: end, is_booked: true })
      .select("id")
      .single();
    if (slotErr) throw slotErr;

    const { error: sessErr } = await admin.from("mentorship_sessions").insert({
      mentor_id: mentorUser.user.id,
      mentee_id: menteeUser.user.id,
      availability_slot_id: slot.id,
      session_type: "quick_question",
      scheduled_start: start,
      scheduled_end: end,
      status: "confirmed",
    });
    if (sessErr) throw sessErr;

    const url = new URL(baseURL ?? "http://localhost:3000");

    // The mentee's own view must show the MENTOR's real name.
    const menteeCookie = await mintSessionCookie(menteeEmail);
    const menteeContext = await browser.newContext();
    await menteeContext.addCookies([
      { name: menteeCookie.name, value: menteeCookie.value, domain: url.hostname, path: "/" },
    ]);
    const menteePage = await menteeContext.newPage();
    await menteePage.goto("/mentorship/sessions");
    await expect(menteePage.getByText("Mentor RealName")).toBeVisible();
    await expect(menteePage.getByText(/^Mentor · /)).toHaveCount(0);
    await menteeContext.close();

    // The mentor's own view must show the MENTEE's real name.
    const mentorCookie = await mintSessionCookie(mentorEmail);
    const mentorContext = await browser.newContext();
    await mentorContext.addCookies([
      { name: mentorCookie.name, value: mentorCookie.value, domain: url.hostname, path: "/" },
    ]);
    const mentorPage = await mentorContext.newPage();
    await mentorPage.goto("/mentorship/sessions/mentor");
    await expect(mentorPage.getByText("Mentee RealName")).toBeVisible();
    await expect(mentorPage.getByText(/^Mentee · /)).toHaveCount(0);
    await mentorContext.close();
  } finally {
    await admin.auth.admin.deleteUser(mentorUser.user.id).catch(() => {});
    await admin.auth.admin.deleteUser(menteeUser.user.id).catch(() => {});
  }
});
