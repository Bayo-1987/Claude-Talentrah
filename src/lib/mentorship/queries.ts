import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MentorshipSessionType } from "@/lib/mentorship/pricing";

/**
 * All reads here go through the AUTHENTICATED client, not service role —
 * every one of these is exactly what 0133's RLS policies already allow a
 * signed-in user to see (approved mentors publicly, their own row otherwise,
 * their own sessions either side), so there is nothing here a service-role
 * bypass would add except risk.
 *
 * ONE EXCEPTION: a mentor's display NAME. `mentor_profiles` does have a
 * public-when-approved SELECT policy, but the name itself lives on
 * `profiles`, which carries only two self-scoped policies ("profiles are
 * self-readable"/"...-updatable", both `auth.uid() = id`) — no carve-out for
 * a mentor's name being publicly visible. An embedded
 * `profiles!mentor_profiles_user_id_fkey(...)` join through this same
 * authenticated client silently returned null for any viewer who wasn't the
 * row owner (not an error — RLS just filters the joined row out), so every
 * mentor's name showed as the generic fallback to every viewer except
 * themselves. Fixed (0167) the same way `talent_directory_portfolio_items()`
 * (0135) already solved the identical shape of problem for another table:
 * a narrow, SECURITY DEFINER `mentor_public_names()` function, re-deriving
 * eligibility itself (an approved `mentor_profiles` row) rather than relying
 * on `profiles`' own RLS — never a widened SELECT policy on `profiles`
 * itself (0030's own lesson: RLS row policies don't restrict columns, so a
 * broader read policy plus the existing self-write policy is a bigger
 * surface than it looks).
 */

export interface MentorListing {
  userId: string;
  name: string;
  bio: string | null;
  expertiseRoles: string[];
  expertiseIndustries: string[];
  expertiseSeniority: string[];
  yearsExperience: number | null;
  basePriceNgn: number | null;
  reviewCount: number;
  averageRating: number | null;
}

export async function browseMentors(): Promise<MentorListing[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select(
      "user_id, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, mentorship_reviews(rating)",
    )
    .eq("status", "approved")
    .eq("self_paused", false);

  if (error) throw error;
  const rows = data ?? [];

  // Batched, not one call per mentor — see mentor_public_names' own comment
  // (0167) for why the name can't come from an embedded profiles join.
  const { data: names, error: namesError } = await supabase.rpc("mentor_public_names", {
    p_mentor_ids: rows.map((r) => r.user_id),
  });
  if (namesError) throw namesError;
  const nameById = new Map(
    (names ?? []).map((n) => [n.user_id, [n.first_name, n.last_name].filter(Boolean).join(" ").trim()]),
  );

  return rows.map((r) => {
    const ratings = (r.mentorship_reviews ?? []).map((rev) => rev.rating);
    return {
      userId: r.user_id,
      // Only reachable if mentor_public_names returned nothing for an id its
      // own gate should have matched — status='approved' here and there
      // disagreeing, which would itself be a bug worth a second look.
      name: nameById.get(r.user_id) || "A Talentrah mentor",
      bio: r.bio,
      expertiseRoles: r.expertise_roles,
      expertiseIndustries: r.expertise_industries,
      expertiseSeniority: r.expertise_seniority,
      yearsExperience: r.years_experience,
      basePriceNgn: r.base_price_ngn,
      reviewCount: ratings.length,
      averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    };
  });
}

export interface MentorAvailabilitySlot {
  id: string;
  startAt: string;
  endAt: string;
}

export interface MentorProfileDetail extends MentorListing {
  openSlots: MentorAvailabilitySlot[];
}

export async function getMentorProfile(mentorUserId: string): Promise<MentorProfileDetail | null> {
  const supabase = await createClient();
  const { data: mentor, error } = await supabase
    .from("mentor_profiles")
    .select(
      "user_id, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, mentorship_reviews(rating)",
    )
    .eq("status", "approved")
    .eq("self_paused", false)
    .eq("user_id", mentorUserId)
    .maybeSingle();

  if (error) throw error;
  if (!mentor) return null;

  const [{ data: slots }, { data: names, error: namesError }] = await Promise.all([
    supabase
      .from("mentor_availability_slots")
      .select("id, start_at, end_at")
      .eq("mentor_id", mentorUserId)
      .eq("is_booked", false)
      .gt("start_at", new Date().toISOString())
      .order("start_at", { ascending: true }),
    // Single-element array — same batched function browseMentors() uses
    // (0167); see mentor_public_names' own comment for why the name can't
    // come from an embedded profiles join.
    supabase.rpc("mentor_public_names", { p_mentor_ids: [mentorUserId] }),
  ]);
  if (namesError) throw namesError;

  const found = (names ?? [])[0];
  const name = found ? [found.first_name, found.last_name].filter(Boolean).join(" ").trim() : "";
  const ratings = (mentor.mentorship_reviews ?? []).map((rev) => rev.rating);

  return {
    userId: mentor.user_id,
    // Only reachable if mentor_public_names returned nothing for an id the
    // query above just confirmed is approved — see browseMentors' own note.
    name: name || "A Talentrah mentor",
    bio: mentor.bio,
    expertiseRoles: mentor.expertise_roles,
    expertiseIndustries: mentor.expertise_industries,
    expertiseSeniority: mentor.expertise_seniority,
    yearsExperience: mentor.years_experience,
    basePriceNgn: mentor.base_price_ngn,
    reviewCount: ratings.length,
    averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    openSlots: (slots ?? []).map((s) => ({ id: s.id, startAt: s.start_at, endAt: s.end_at })),
  };
}

export interface OwnMentorProfile {
  status: string;
  bio: string | null;
  expertiseRoles: string[];
  expertiseIndustries: string[];
  /** Never selected before this fix — the edit form silently dropped it on every save that didn't re-type it. */
  yearsExperience: number | null;
  basePriceNgn: number | null;
  reviewNote: string | null;
  /** Second, independent opt-in on top of status='approved' (0142) — see reviews-verifications-toggle.tsx. */
  reviewsVerifications: boolean;
  /** Mentor's own pause on their public listing, independent of status (0174) — see self-pause-toggle.tsx. Never filtered here: a mentor must always see and control their own pause state, regardless of its value. */
  selfPaused: boolean;
}

/** The signed-in user's own mentor application/profile, whatever its status — unlike browseMentors, this bypasses the approved-only filter via the SELECT policy's own `user_id = auth.uid()` half. */
export async function getOwnMentorProfile(userId: string): Promise<OwnMentorProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select(
      "status, bio, expertise_roles, expertise_industries, years_experience, base_price_ngn, review_note, reviews_verifications, self_paused",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.status,
    bio: data.bio,
    expertiseRoles: data.expertise_roles,
    expertiseIndustries: data.expertise_industries,
    yearsExperience: data.years_experience,
    basePriceNgn: data.base_price_ngn,
    reviewNote: data.review_note,
    reviewsVerifications: data.reviews_verifications,
    selfPaused: data.self_paused,
  };
}

export interface OwnPayoutDetails {
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  verifiedAt: string | null;
}

/**
 * The mentor's own payout bank details — read-only here (0149). Nothing
 * writes through the authenticated client: saveMentorPayoutDetailsAction
 * (src/lib/mentorship/payout-details.ts) uses the service-role client for
 * every write, because none of these five columns are in 0133/0149's
 * `authenticated` UPDATE grant on mentor_profiles — see 0149's own migration
 * header for why `payout_account_name` specifically must never be
 * client-writable.
 */
export async function getOwnPayoutDetails(userId: string): Promise<OwnPayoutDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("payout_bank_code, payout_account_number, payout_account_name, payout_bank_verified_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    bankCode: data.payout_bank_code,
    accountNumber: data.payout_account_number,
    accountName: data.payout_account_name,
    verifiedAt: data.payout_bank_verified_at,
  };
}

export async function getOwnAvailabilitySlots(mentorUserId: string): Promise<MentorAvailabilitySlot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentor_availability_slots")
    .select("id, start_at, end_at, is_booked")
    .eq("mentor_id", mentorUserId)
    .order("start_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((s) => !s.is_booked)
    .map((s) => ({ id: s.id, startAt: s.start_at, endAt: s.end_at }));
}

export interface MentorshipSessionSummary {
  id: string;
  mentorId: string;
  menteeId: string;
  mentorName: string;
  menteeName: string;
  sessionType: MentorshipSessionType;
  scheduledStart: string;
  scheduledEnd: string;
  priceNgn: number;
  status: string;
  meetingLink: string | null;
}

/**
 * NO EMBEDDED JOIN for the names, deliberately. `mentorship_sessions.mentor_id`
 * has an FK to `mentor_profiles(user_id)`, not to `profiles` directly — so
 * PostgREST's `profiles!mentorship_sessions_mentor_id_fkey(...)` embed syntax
 * has no real constraint to resolve against (that named constraint points at
 * `mentor_profiles`, not `profiles`) and would fail at runtime with an
 * unhelpful schema-cache error. Two queries, one lookup map, is cheaper than
 * being wrong about a guessed embed path — the same call `fulfill.ts` makes
 * for its own receipt lookup.
 *
 * THE SECOND QUERY IS AN RPC, NOT A PLAIN `profiles` SELECT — the same shape
 * of bug 0167 fixed for mentor_public_names(): `profiles` carries only two
 * self-scoped RLS policies, so `.from("profiles").select(...).in("id",
 * profileIds)` through this authenticated client silently returned only the
 * CALLER's own row, never the other party's — a mentee viewing their own
 * booked session saw the generic "Mentor" fallback instead of the mentor's
 * real name, and vice versa for a mentor viewing theirs. Confirmed live
 * before fixing. mentorship_session_counterparty_names() (0168) is NOT
 * mentor_public_names() reused — a session counterparty is not public the
 * way an approved mentor's listing is; the function derives its own
 * eligibility from `auth.uid()` (only the name of someone the caller
 * actually shares a real mentorship_sessions row with), never a
 * client-supplied id.
 */
async function loadSessions(userId: string, side: "mentor_id" | "mentee_id"): Promise<MentorshipSessionSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentorship_sessions")
    .select("id, mentor_id, mentee_id, session_type, scheduled_start, scheduled_end, price_ngn, status, meeting_link")
    .eq(side, userId)
    .order("scheduled_start", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const profileIds = [...new Set(rows.flatMap((r) => [r.mentor_id, r.mentee_id]))];
  const { data: names, error: namesError } = await supabase.rpc("mentorship_session_counterparty_names", {
    p_user_ids: profileIds,
  });
  if (namesError) throw namesError;
  const nameById = new Map(
    (names ?? []).map((p) => [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()]),
  );

  return rows.map((r) => ({
    id: r.id,
    mentorId: r.mentor_id,
    menteeId: r.mentee_id,
    // The caller's OWN id never resolves here — mentorship_session_
    // counterparty_names() only returns a session's OTHER party, by design
    // (see its own comment). Harmless: sessions/page.tsx only ever renders
    // mentorName, and sessions/mentor/page.tsx only ever renders menteeName
    // — each caller only ever sees the field naming the party that isn't
    // them, so the caller's own row missing from this map never surfaces.
    mentorName: nameById.get(r.mentor_id) || "Mentor",
    menteeName: nameById.get(r.mentee_id) || "Mentee",
    sessionType: r.session_type as MentorshipSessionType,
    scheduledStart: r.scheduled_start,
    scheduledEnd: r.scheduled_end,
    priceNgn: r.price_ngn,
    status: r.status,
    meetingLink: r.meeting_link,
  }));
}

export async function sessionsAsMentee(userId: string) {
  return loadSessions(userId, "mentee_id");
}

export async function sessionsAsMentor(userId: string) {
  return loadSessions(userId, "mentor_id");
}
