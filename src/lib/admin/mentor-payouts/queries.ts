import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Admin visibility for mentor payouts (0139, send-141-ish "Mentorship v2,
 * part 1"). Reuses the existing `mentor_review` permission rather than
 * inventing a new one — the same reasoning `requirePermission`'s own
 * comments already apply elsewhere in this admin surface: `mentor_review`
 * already gates the one other mentor-specific trust decision in this app
 * (who becomes a mentor at all), and this is the operational extension of
 * that same relationship — whether an approved mentor actually gets paid.
 * `finance` was considered and rejected: that page is deliberately PII-free
 * aggregate totals with no names and no actions (its own header: "no
 * adjustment path anywhere... an admin balance-edit button is that bug with
 * different paperwork"). This page is the opposite shape — named mentors,
 * per-session detail, and a real write action (manual retry) — which is
 * exactly the shape `mentor_review`'s other screen already has.
 */

export interface MentorPayoutRow {
  id: string;
  sessionId: string;
  mentorId: string;
  mentorName: string;
  amountNgn: number;
  status: string;
  eligibleAt: string;
  attemptCount: number;
  failureReason: string | null;
  paystackTransferCode: string | null;
  paidAt: string | null;
  createdAt: string;
}

export async function listMentorPayouts(): Promise<MentorPayoutRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("mentor_payouts")
    .select("id, session_id, mentor_id, amount_ngn, status, eligible_at, attempt_count, failure_reason, paystack_transfer_code, paid_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // No embedded join — mentor_payouts.mentor_id has an FK to
  // mentor_profiles(user_id), not to profiles directly, same reasoning
  // src/lib/mentorship/queries.ts's loadSessions already documents for the
  // identical shape.
  const mentorIds = [...new Set(rows.map((r) => r.mentor_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, first_name, last_name").in("id", mentorIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()]));

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    mentorId: r.mentor_id,
    mentorName: nameById.get(r.mentor_id) || "(no name on file)",
    amountNgn: r.amount_ngn,
    status: r.status,
    eligibleAt: r.eligible_at,
    attemptCount: r.attempt_count,
    failureReason: r.failure_reason,
    paystackTransferCode: r.paystack_transfer_code,
    paidAt: r.paid_at,
    createdAt: r.created_at,
  }));
}

/** For the nav badge — failed payouts are the only ones needing an operator's attention; pending/processing/paid are not a to-do list. */
export async function failedMentorPayoutCount(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .from("mentor_payouts")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");
  if (error) throw error;
  return count ?? 0;
}
