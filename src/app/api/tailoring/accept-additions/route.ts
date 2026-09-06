import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeStructuredResume } from "@/lib/resume/sanitize";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { mergeAcceptedAdditions } from "@/lib/tailoring/apply-additions";
import type { ProposedAddition } from "@/lib/tailoring/types";

/**
 * The ONLY path by which a `proposedAddition` reaches a saved resume —
 * called only when the candidate has explicitly checked at least one item
 * on the tailoring result screen. See src/lib/tailoring/grounding.ts's
 * header for the full incident this whole review flow exists to prevent.
 *
 * `proposedAdditions` isn't persisted server-side (no new column — this PR
 * carries no migration), so the accepted items are the client's own copy of
 * what /api/tailoring returned a moment earlier, echoed back. This is not a
 * new trust boundary: a user can already freely rewrite every field of
 * their own resume through the Resume Builder's normal edit flow, so a
 * client sending back arbitrary text for their OWN resumeId is exactly as
 * trusted (and exactly as owner-scoped by RLS) as an ordinary resume edit
 * already is. What this route actually guards against is Farah adding
 * something the candidate never saw or agreed to — not a candidate lying to
 * themselves on purpose, which was always their own call to make.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { resumeId?: unknown; accepted?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const resumeId = typeof body.resumeId === "string" ? body.resumeId : null;
  const accepted = Array.isArray(body.accepted) ? (body.accepted as ProposedAddition[]) : null;

  if (!resumeId || !accepted) {
    return NextResponse.json({ error: "Missing resumeId or accepted list." }, { status: 400 });
  }
  if (accepted.length === 0) {
    return NextResponse.json({ error: "Nothing was accepted." }, { status: 400 });
  }

  // .eq("user_id", user.id) is belt-and-braces on top of RLS's owner-only
  // policy — both must agree, same convention as the employer job-edit path.
  const { data: row, error: fetchError } = await supabase
    .from("resumes")
    .select("structured_content")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Couldn't find that resume." }, { status: 404 });
  }

  const current = (row.structured_content as StructuredResume | null) ?? EMPTY_RESUME;
  const merged = mergeAcceptedAdditions(current, accepted);
  // Re-sanitized, not trusted as-is: `accepted` crossed a client boundary,
  // matching the same convention resume-builder/actions.ts uses for its own
  // client-boundary-crossing import path.
  const sanitized = sanitizeStructuredResume(merged);

  const { error: updateError } = await supabase
    .from("resumes")
    .update({ structured_content: JSON.parse(JSON.stringify(sanitized)) })
    .eq("id", resumeId)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Couldn't save those changes — try again." }, { status: 500 });
  }

  return NextResponse.json({ resume: sanitized });
}
