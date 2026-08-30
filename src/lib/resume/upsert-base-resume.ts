import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { StructuredResume } from "./types";

const UNIQUE_VIOLATION = "23505";

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
  /*
   * Spread rather than always set: an undefined confidence must leave an
   * existing value alone on update, not overwrite a recorded `low` with null
   * the next time the builder saves the same row.
   */
  const confidenceField = parseConfidence ? { parse_confidence: parseConfidence } : {};

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
    const { error: updateError } = await supabase
      .from("resumes")
      .update({ title, source, structured_content: content, ...confidenceField, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`Couldn't update your resume: ${updateError.message}`);
    }
    return { id: existing.id };
  }

  const { data: created, error: insertError } = await supabase
    .from("resumes")
    .insert({ user_id: userId, is_base: true, title, source, structured_content: content, ...confidenceField })
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
      .update({ title, source, structured_content: content, ...confidenceField, updated_at: new Date().toISOString() })
      .eq("id", winner.id);
    if (updateError) {
      throw new Error(`Couldn't update your resume: ${updateError.message}`);
    }
    return { id: winner.id };
  }

  throw new Error(insertError?.message ?? "Couldn't save your resume — please try again.");
}
