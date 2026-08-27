"use server";

import { createClient } from "@/lib/supabase/server";
import { feedbackSchema } from "./schemas";
// State shape lives outside this file on purpose — a "use server" module may
// export nothing but async functions. See state.ts.
import type { FeedbackActionState } from "./state";

export async function submitFeedbackAction(
  _prevState: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const parsed = feedbackSchema.safeParse({
    category: formData.get("category"),
    message: formData.get("message"),
    pagePath: formData.get("pagePath"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      error: "Check the highlighted fields below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", error: "Sign in again — your session has expired." };
  }

  /*
   * No `.select()` on this insert, and that is not an oversight.
   *
   * 0054 revokes SELECT on `feedback` from `authenticated`. PostgREST asks for
   * the inserted row back whenever a representation is requested, so adding
   * `.select()` here would make every successful submission fail with a
   * permission error — the write having already happened. The write-only
   * design and the call shape have to agree, so they are noted together.
   *
   * `user_id` is sent explicitly rather than left to a default because the
   * INSERT policy checks it: `with check (user_id = auth.uid())`. A row that
   * names someone else is refused by the database, not by this function.
   */
  const { error } = await supabase.from("feedback").insert({
    user_id: user.id,
    category: parsed.data.category,
    message: parsed.data.message,
    page_path: parsed.data.pagePath,
  });

  if (error) {
    // Deliberately not echoed to the user: a Postgres error string here would
    // describe our policies to whoever provoked it.
    console.error("[feedback:insert]", error);
    return {
      status: "error",
      error: "We couldn't save that just now. Try again in a moment.",
    };
  }

  return { status: "success", error: null };
}
