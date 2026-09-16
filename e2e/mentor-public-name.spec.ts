/**
 * A mentor's real name was invisible to every viewer except themselves
 * (0167). browseMentors()/getMentorProfile() fetched the display name via an
 * embedded `profiles!mentor_profiles_user_id_fkey(...)` join through the
 * authenticated client — but `profiles` carries only two self-scoped RLS
 * policies, no carve-out for a mentor's name being publicly visible, so the
 * join silently returned null for any non-owner and the "A Talentrah
 * mentor" fallback fired every time. Fixed via mentor_public_names(), a
 * narrow SECURITY DEFINER function (same pattern
 * talent_directory_portfolio_items() already uses for the identical shape
 * of problem) — see src/lib/mentorship/queries.ts's own header comment.
 *
 * Proven to catch the regression before being trusted: reverting
 * queries.ts to the pre-0167 embedded-join version made this fail exactly
 * where expected (the real name never appears, the generic fallback does)
 * — not a superficial pass.
 *
 * Uses two independent, genuinely separate signed-in browser contexts
 * (mentor, then a different viewer) rather than the shared `authed` fixture,
 * which only ever gives one authenticated context per test.
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

base("a mentor's real name is visible to a DIFFERENT signed-in viewer, not just themselves", async ({
  browser,
  baseURL,
}) => {
  base.setTimeout(60_000);
  const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
  const mentorEmail = `mentor-${randomUUID()}@${domain}`;
  const viewerEmail = `viewer-${randomUUID()}@${domain}`;

  const { data: mentorUser, error: mentorErr } = await admin.auth.admin.createUser({
    email: mentorEmail,
    email_confirm: true,
  });
  if (mentorErr) throw mentorErr;
  const { data: viewerUser, error: viewerErr } = await admin.auth.admin.createUser({
    email: viewerEmail,
    email_confirm: true,
  });
  if (viewerErr) throw viewerErr;

  try {
    // Give the mentor a distinctive real name and an approved mentor_profiles row.
    const { error: nameErr } = await admin
      .from("profiles")
      .update({ first_name: "Zimcrest", last_name: "TestMentor" })
      .eq("id", mentorUser.user.id);
    if (nameErr) throw nameErr;

    const { error: mpErr } = await admin.from("mentor_profiles").insert({
      user_id: mentorUser.user.id,
      status: "approved",
      bio: "Repro test mentor",
    });
    if (mpErr) throw mpErr;

    const mentorCookie = await mintSessionCookie(mentorEmail);
    const viewerCookie = await mintSessionCookie(viewerEmail);

    const url = new URL(baseURL ?? "http://localhost:3010");

    // Signed in as a DIFFERENT account — this is the actual bug repro.
    const viewerContext = await browser.newContext();
    await viewerContext.addCookies([
      { name: viewerCookie.name, value: viewerCookie.value, domain: url.hostname, path: "/" },
    ]);
    const viewerPage = await viewerContext.newPage();

    await viewerPage.goto(`/mentorship/${mentorUser.user.id}`);
    await expect(viewerPage.getByRole("heading", { name: "Zimcrest TestMentor" })).toBeVisible();
    await expect(viewerPage.getByText("A Talentrah mentor")).toHaveCount(0);
    console.log("  [repro] non-owner viewer: detail page shows real name — PASS");

    await viewerPage.goto("/mentorship");
    await expect(viewerPage.getByText("Zimcrest TestMentor")).toBeVisible();
    await expect(viewerPage.getByText("A Talentrah mentor")).toHaveCount(0);
    console.log("  [repro] non-owner viewer: browse list shows real name — PASS");

    await viewerContext.close();

    // Control: the mentor's OWN account should also see their real name
    // (this already worked before the fix — confirming it still does).
    const mentorContext = await browser.newContext();
    await mentorContext.addCookies([
      { name: mentorCookie.name, value: mentorCookie.value, domain: url.hostname, path: "/" },
    ]);
    const mentorPage = await mentorContext.newPage();
    await mentorPage.goto(`/mentorship/${mentorUser.user.id}`);
    await expect(mentorPage.getByRole("heading", { name: "Zimcrest TestMentor" })).toBeVisible();
    console.log("  [repro] owner's own view: still shows real name — PASS (control)");
    await mentorContext.close();
  } finally {
    await admin.auth.admin.deleteUser(mentorUser.user.id).catch(() => {});
    await admin.auth.admin.deleteUser(viewerUser.user.id).catch(() => {});
  }
});
