import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Postgres hands timestamps back as "…+00:00"; every time that leaves this module is a plain UTC ISO string with a Z. */
const iso = (value: string) => new Date(value).toISOString();

export interface SlotView {
  id: string;
  startsAt: string;
  durationMinutes: number;
}

export interface BookingView {
  id: string;
  startsAt: string;
  durationMinutes: number;
  status: string;
}

export interface EmployerScheduleState {
  /** The current open offer, if any. */
  open: { offerId: string; kind: string; note: string | null; slots: SlotView[]; state: string } | null;
  /** The latest booking (booked or cancelled) for this application, if any. */
  booking: BookingView | null;
}

/** What the employer's schedule page shows for one application. Read with the service role AFTER the action/page has proved the application is the caller's own organisation's applicant. */
export async function loadEmployerScheduleState(applicationId: string): Promise<EmployerScheduleState> {
  const admin = createServiceRoleClient();
  const [{ data: offer }, { data: bookings }] = await Promise.all([
    admin.from("interview_offers").select("id, kind, note").eq("application_id", applicationId).eq("status", "open").maybeSingle(),
    admin.from("interview_bookings").select("id, starts_at, duration_minutes, status").eq("application_id", applicationId).order("booked_at", { ascending: false }).limit(1),
  ]);
  let open: EmployerScheduleState["open"] = null;
  if (offer) {
    const [{ data: slots }, { data: state }] = await Promise.all([
      admin.from("interview_slots").select("id, starts_at, duration_minutes").eq("offer_id", offer.id).order("starts_at"),
      admin.rpc("interview_offer_state", { p_offer: offer.id }),
    ]);
    open = { offerId: offer.id, kind: offer.kind, note: offer.note, state: state ?? "open", slots: (slots ?? []).map((s) => ({ id: s.id, startsAt: iso(s.starts_at), durationMinutes: s.duration_minutes })) };
  }
  const b = bookings?.[0];
  return { open, booking: b ? { id: b.id, startsAt: iso(b.starts_at), durationMinutes: b.duration_minutes, status: b.status } : null };
}

export interface CandidateOfferView {
  offerId: string;
  state: string;
  kind: string;
  note: string | null;
  orgName: string;
  jobTitle: string;
  slots: SlotView[];
  booking: BookingView | null;
}

/** The invitation as the candidate sees it, or null unless it is on THEIR OWN application (the page then answers not-found). */
export async function loadCandidateOffer(offerId: string, userId: string): Promise<CandidateOfferView | null> {
  const admin = createServiceRoleClient();
  const { data: offer } = await admin.from("interview_offers").select("id, kind, note, application_id, job_posting_id, organization_id").eq("id", offerId).maybeSingle();
  if (!offer) return null;
  const { data: application } = await admin.from("applications").select("user_id").eq("id", offer.application_id).maybeSingle();
  if (!application || application.user_id !== userId) return null;
  const [{ data: slots }, { data: state }, { data: org }, { data: job }, { data: bookings }] = await Promise.all([
    admin.from("interview_slots").select("id, starts_at, duration_minutes").eq("offer_id", offerId).order("starts_at"),
    admin.rpc("interview_offer_state", { p_offer: offerId }),
    admin.from("organizations").select("name").eq("id", offer.organization_id).maybeSingle(),
    admin.from("job_postings").select("title").eq("id", offer.job_posting_id).maybeSingle(),
    admin.from("interview_bookings").select("id, starts_at, duration_minutes, status").eq("offer_id", offerId).limit(1),
  ]);
  const b = bookings?.[0];
  return {
    offerId,
    state: state ?? "not_found",
    kind: offer.kind,
    note: offer.note,
    orgName: org?.name ?? "The employer",
    jobTitle: job?.title ?? "the role",
    slots: (slots ?? []).map((s) => ({ id: s.id, startsAt: iso(s.starts_at), durationMinutes: s.duration_minutes })),
    booking: b ? { id: b.id, startsAt: iso(b.starts_at), durationMinutes: b.duration_minutes, status: b.status } : null,
  };
}

/** The next booked interview time of each of this person's applications (for the Job Tracker line), keyed by application id. */
export async function loadBookedInterviewsFor(userId: string, applicationIds: string[]): Promise<Map<string, { startsAt: string; offerId: string }>> {
  if (applicationIds.length === 0) return new Map();
  const admin = createServiceRoleClient();
  // Scoped to the caller's own applications in the same query, so an id that is not theirs can never return a row.
  const { data: own } = await admin.from("applications").select("id").eq("user_id", userId).in("id", applicationIds);
  const ownIds = (own ?? []).map((a) => a.id);
  if (ownIds.length === 0) return new Map();
  const { data } = await admin.from("interview_bookings").select("application_id, offer_id, starts_at").in("application_id", ownIds).eq("status", "booked").order("starts_at");
  const out = new Map<string, { startsAt: string; offerId: string }>();
  for (const row of data ?? []) if (!out.has(row.application_id)) out.set(row.application_id, { startsAt: iso(row.starts_at), offerId: row.offer_id });
  return out;
}
