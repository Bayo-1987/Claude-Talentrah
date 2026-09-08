import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { StructuredResume } from "./types";

const UNIQUE_VIOLATION = "23505";

/**
 * `parse_confidence` is deliberately NOT in 0041/0070's UPDATE grant to
 * `authenticated` — 0070's own header explains why: it must stay server-set,
 * a fact about the parse, not something a client can supply. That means the
 * RLS-scoped `supabase` client this function otherwise uses for every other
 * field on an UPDATE cannot include this column in the same call once a base
 * resume already exists — `update` on `resumes` has no table-level grant at
 * all, only the narrow column grant, and `parse_confidence` isn't in it.
 *
 * This was a REAL, LIVE bug, not a theoretical one: INSERT has no such
 * column restriction (0070's own investigation confirms table-level INSERT
 * is granted, unrestricted by column), so a user's FIRST upload always
 * worked — but every subsequent upload for the same user hit the UPDATE
 * branch, which always included `parse_confidence` once a caller passed one
 * (both real callers always do), and failed outright with `permission
 * denied for table resumes`. Confirmed against a real second call before
 * this fix; see tests/resume/upsert-base-resume.test.ts.
 *
 * Fixed by giving this one column its own service-role write, scoped to
 * exactly one row (matched by id AND user_id, defense in depth even though
 * service-role bypasses RLS) — narrow enough that it can't become a general
 * escape hatch for the rest of the row. Best-effort and non-fatal:
 * `parse_confidence` is diagnostic only (0070/issue #139 — "queryable
 * instead of inferred"), so a transient failure writing it must not turn an
 * otherwise-successful resume save into an error the user sees.
 */
async function writeParseConfidence(
  resumeId: string,
  userId: string,
  parseConfidence: "high" | "low" | undefined,
): Promise<void> {
  // undefined must leave an existing value alone, not overwrite a recorded
  // `low` with null the next time a non-parse caller (the builder) saves —
  // same contract the old inline `confidenceField` spread documented.
  if (!parseConfidence) return;
  const { error } = await createServiceRoleClient()
    .from("resumes")
    .update({ parse_confidence: parseConfidence })
    .eq("id", resumeId)
    .eq("user_id", userId);
  if (error) {
    console.error("[upsertBaseResume] couldn't record parse_confidence:", error);
  }
}

/**
 * The only sanctioned way to write a user's base (is_base=true) resume —
 * every call site (upload, and anything else that might set is_base in the
 * future) must go through this, not a raw insert. Replaces the existing
 * base resume in place rather than inserting a second one (QA audit bug #1:
 * resume upload used to insert unconditionally, which silently broke match
 * scoring/tailoring/apply once a user had two).
 *
 * The DB also enforces this structurally now (see migration
 * 0010_one_base_resume_per_user — a unique partial index on
 * resumes(user_id) where is_base=true), so even a bypass of this function
 * can't actually create a duplicate; it can only fail loudly. The retry
 * here exists only to make a genuine race between two concurrent uploads
 * self-heal into "last write wins" instead of surfacing that race as an
 * error to whichever request lost it.
 */
export async function upsertBaseResume(
  supabase: SupabaseClient<Database>,
  userId: string,
  structuredContent: StructuredResume,
  source: Database["public"]["Enums"]["resume_source"],
  title = "My resume",
  /*
   * How well the upload parsed, when the caller knows. Written so a degraded
   * parse is queryable instead of having to be inferred from the shape of the
   * stored fields — see 0070 and issue #139. Callers that are not a parse (the
   * builder) pass nothing and leave it null, which is the honest value: they
   * did not parse anything.
   */
  parseConfidence?: "high" | "low",
): Promise<{ id: string }> {
  const content = JSON.parse(JSON.stringify(structuredContent));

  const { data: existing, error: selectError } = await supabase
    .from("resumes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Couldn't look up your existing resume: ${selectError.message}`);
  }

  if (existing) {
    // parse_confidence is NOT included here — see writeParseConfidence's own
    // header for why this RLS-scoped client can't write that column, and why
    // it's a separate call below rather than folded into this one.
    const { error: updateError } = await supabase
      .from("resumes")
      .update({ title, source, structured_content: content, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`Couldn't update your resume: ${updateError.message}`);
    }
    await writeParseConfidence(existing.id, userId, parseConfidence);
    return { id: existing.id };
  }

  // INSERT has no column-level restriction (unlike UPDATE), so
  // parse_confidence is safe to include directly here — confirmed against
  // the live grant catalog in 0070's own header.
  const { data: created, error: insertError } = await supabase
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: true,
      title,
      source,
      structured_content: content,
      ...(parseConfidence ? { parse_confidence: parseConfidence } : {}),
    })
    .select("id")
    .single();

  if (!insertError && created) {
    return { id: created.id };
  }

  // Lost a race with a concurrent upload that inserted first — fall back to
  // updating the row it just created, so the net result is still exactly
  // one base resume (this request's content, since it ran last).
  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: winner, error: refetchError } = await supabase
      .from("resumes")
      .select("id")
      .eq("user_id", userId)
      .eq("is_base", true)
      .single();
    if (refetchError || !winner) {
      throw new Error("Couldn't save your resume — please try again.");
    }
    const { error: updateError } = await supabase
      .from("resumes")
      .update({ title, source, structured_content: content, updated_at: new Date().toISOString() })
      .eq("id", winner.id);
    if (updateError) {
      throw new Error(`Couldn't update your resume: ${updateError.message}`);
    }
    await writeParseConfidence(winner.id, userId, parseConfidence);
    return { id: winner.id };
  }

  throw new Error(insertError?.message ?? "Couldn't save your resume — please try again.");
}
