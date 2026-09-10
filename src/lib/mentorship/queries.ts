import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MentorshipSessionType } from "@/lib/mentorship/pricing";

/**
 * All reads here go through the AUTHENTICATED client, not service role —
 * every one of these is exactly what 0133's RLS policies already allow a
 * signed-in user to see (approved mentors publicly, their own row otherwise,
 * their own sessions either side), so there is nothing here a service-role
 * bypass would add except risk.
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
      "user_id, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, profiles!mentor_profiles_user_id_fkey(first_name, last_name), mentorship_reviews(rating)",
    )
    .eq("status", "approved");

  if (error) throw error;
  return (data ?? []).map((r) => {
    const profile = r.profiles;
    const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() : "";
    const ratings = (r.mentorship_reviews ?? []).map((rev) => rev.rating);
    return {
      userId: r.user_id,
      name: name || "A Talentrah mentor",
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
      "user_id, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, profiles!mentor_profiles_user_id_fkey(first_name, last_name), mentorship_reviews(rating)",
    )
    .eq("status", "approved")
    .eq("user_id", mentorUserId)
    .maybeSingle();

  if (error) throw error;
  if (!mentor) return null;

  const { data: slots } = await supabase
    .from("mentor_availability_slots")
    .select("id, start_at, end_at")
    .eq("mentor_id", mentorUserId)
    .eq("is_booked", false)
    .gt("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });

  const profile = mentor.profiles;
  const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() : "";
  const ratings = (mentor.mentorship_reviews ?? []).map((rev) => rev.rating);

  return {
    userId: mentor.user_id,
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
  basePriceNgn: number | null;
  reviewNote: string | null;
  /** Second, independent opt-in on top of status='approved' (0142) — see reviews-verifications-toggle.tsx. */
  reviewsVerifications: boolean;
}

/** The signed-in user's own mentor application/profile, whatever its status — unlike browseMentors, this bypasses the approved-only filter via the SELECT policy's own `user_id = auth.uid()` half. */
export async function getOwnMentorProfile(userId: string): Promise<OwnMentorProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("status, bio, expertise_roles, expertise_industries, base_price_ngn, review_note, reviews_verifications")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.status,
    bio: data.bio,
    expertiseRoles: data.expertise_roles,
    expertiseIndustries: data.expertise_industries,
    basePriceNgn: data.base_price_ngn,
    reviewNote: data.review_note,
    reviewsVerifications: data.reviews_verifications,
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
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", profileIds);
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()]),
  );

  return rows.map((r) => ({
    id: r.id,
    mentorId: r.mentor_id,
    menteeId: r.mentee_id,
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
