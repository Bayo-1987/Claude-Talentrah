import { NextResponse } from "next/server";
import { setModerationStatus } from "@/lib/scholarships/ingest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdminSecret, internalError } from "@/lib/api/admin-auth";

const VALID_STATUSES = ["pending", "verified", "rejected"] as const;
type ModerationStatus = (typeof VALID_STATUSES)[number];

/**
 * Minimal moderation control for the §6.15 publish gate. A polished review
 * queue UI is explicitly out of M10's scope; the gate itself is not, so this
 * is the operator-facing half of it.
 *
 * GET  — list listings awaiting review (service-role read, so it can see the
 *        `pending` rows that RLS hides from every normal user).
 * POST — flip one listing's status: { id, status, note? }.
 *
 * Both halves were fail-open and both were reachable unauthenticated on the
 * live deployment — GET was returning the pending queue to anyone who asked,
 * and POST would have published any listing to the public catalog. See
 * admin-auth.ts for the captured evidence.
 */

export async function GET(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!VALID_STATUSES.includes(status as ModerationStatus)) {
    return NextResponse.json(
      { error: `status must be one of ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("scholarships")
    .select("id, provider, program_name, application_deadline, official_url, moderation_status, last_checked_at")
    .eq("moderation_status", status as ModerationStatus)
    .order("last_checked_at", { ascending: false });

  if (error) {
    return internalError("moderate-scholarship:list", error);
  }
  return NextResponse.json({ count: data?.length ?? 0, scholarships: data ?? [] });
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let body: { id?: string; status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { id, status, note } = body;
  if (!id || !status || !VALID_STATUSES.includes(status as ModerationStatus)) {
    return NextResponse.json(
      { error: `Requires { id, status } where status is one of ${VALID_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    await setModerationStatus(id, status as ModerationStatus, note);
  } catch (err) {
    return internalError("moderate-scholarship:update", err);
  }

  return NextResponse.json({ ok: true, id, status });
}
