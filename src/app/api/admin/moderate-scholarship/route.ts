import { NextResponse } from "next/server";
import { setModerationStatus } from "@/lib/scholarships/ingest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const VALID_STATUSES = ["pending", "verified", "rejected"] as const;
type ModerationStatus = (typeof VALID_STATUSES)[number];

/**
 * Minimal moderation control for the §6.15 publish gate. A polished review
 * queue UI is explicitly out of M10's scope; the gate itself is not, so
 * this is the operator-facing half of it.
 *
 * GET  — list listings awaiting review (service-role read, so it can see
 *        the `pending` rows that RLS hides from every normal user).
 * POST — flip one listing's status: { id, status, note? }.
 *
 * Authenticated with INGEST_SECRET via x-ingest-secret, matching the other
 * admin routes. Fails closed when the secret is set; open locally when it
 * isn't, same as /api/admin/ingest-jobs.
 */

function unauthorized(request: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false;
  return request.headers.get("x-ingest-secret") !== secret;
}

export async function GET(request: Request) {
  if (unauthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!VALID_STATUSES.includes(status as ModerationStatus)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("scholarships")
    .select("id, provider, program_name, application_deadline, official_url, moderation_status, last_checked_at")
    .eq("moderation_status", status as ModerationStatus)
    .order("last_checked_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ count: data?.length ?? 0, scholarships: data ?? [] });
}

export async function POST(request: Request) {
  if (unauthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Moderation update failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id, status });
}
