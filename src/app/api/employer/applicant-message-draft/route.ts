import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEmployerContext } from "@/lib/employer/membership";
import { draftForEmployer } from "@/lib/employer/applicant-messages/draft-service";

/**
 * "Draft/Refine with Farah" on Message candidate (Premium). A route handler rather than a Server Action on purpose: only a route sees `request.signal`, which aborts when the browser disconnects, and a draft
 * that can never be delivered must not be charged for (the charge is handed back, once, by runFarahMessageDraft). 
 *
 *  POST { jobId, applicationId, kind, mode, notes, subject, body } -> { ok: true, subject, body } | { ok: false, kind, error }
 *
 * The employer's own session decides who may call it: signed in (401), a member of an organisation (403), and the application is an applicant on a job that organisation owns (404-shaped answer); only then is the
 * ad wallet touched. It returns text and nothing else: it cannot send, and the employer presses Send themselves.
 */
export const maxDuration = 60;

const STATUS: Record<string, number> = { not_found: 404, premium_required: 402, insufficient_balance: 402, invalid: 400, generation_error: 502, aborted: 499 };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, kind: "not_signed_in", error: "Sign in again to use Farah." }, { status: 401 });

  let context;
  try {
    context = await getEmployerContext();
  } catch {
    return NextResponse.json({ ok: false, kind: "not_signed_in", error: "Sign in again to use Farah." }, { status: 401 });
  }
  if (!context) return NextResponse.json({ ok: false, kind: "not_found", error: "Set up your company first." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ok: false, kind: "invalid", error: "That request could not be read." }, { status: 400 });
  }

  const result = await draftForEmployer(
    { supabase, userId: user.id, organization: { id: context.organization.id, name: context.organization.name } },
    { jobId: body.jobId, applicationId: body.applicationId, kind: body.kind, mode: body.mode, notes: body.notes, subject: body.subject, body: body.body },
    request.signal,
  );
  return NextResponse.json(result, { status: result.ok ? 200 : (STATUS[result.kind] ?? 500) });
}
