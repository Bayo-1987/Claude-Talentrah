"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeName } from "@/lib/profile/name";
import { settingsSchema } from "./settings-schemas";
import type { SettingsActionState } from "./settings-state";

export async function updateProfileAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = settingsSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    country: formData.get("country"),
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
   * A CHECKED WRITE, from the first commit rather than after the second bug
   * report.
   *
   * A Supabase update that is REFUSED resolves with an `error`; it does not
   * throw. Without `.select()` and both checks below, a policy denial, a
   * column-grant denial, an expired session and a deleted row would all look
   * exactly like a save — and the page would revalidate the OLD values as
   * though they were the new ones. That is the shape that made "Save does
   * nothing" on the tracker's notes unreportable.
   *
   * The columns are named explicitly and are exactly the three that carry an
   * UPDATE grant. Sending `email` or `market_segment` here would fail 42501 —
   * correctly, since 0030 revoked both — so they are not sent.
   */
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      first_name: normalizeName(parsed.data.firstName),
      last_name: normalizeName(parsed.data.lastName),
      country: parsed.data.country,
    })
    .eq("id", user.id)
    .select("id");

  if (error) {
    // 23514 is 0045's visible-name CHECK. The zod rule above should have
    // caught it, so reaching here means the two have drifted apart — say the
    // useful thing rather than the Postgres thing.
    console.error("[settings:update]", error);
    return {
      status: "error",
      error:
        error.code === "23514"
          ? "That name isn't valid — it needs at least one visible character."
          : "We couldn't save that just now. Try again in a moment.",
    };
  }

  if (!updated?.length) {
    // No error and no rows: the row is not this user's, or is gone. Not a
    // success, and it must not be reported as one.
    return { status: "error", error: "We couldn't find your profile to update." };
  }

  /*
   * One call, not two.
   *
   * A `revalidatePath("/", "layout")` was here as well, on the reasoning that
   * the masthead's initials and Farah's greeting live in the (app) layout and
   * would otherwise go stale. That reasoning is wrong, and the test proved it:
   * removing the layout call alone changes nothing, while removing BOTH fails
   * the assertion that the panel shows the new name. Revalidating a page path
   * already covers the layouts above it.
   *
   * Deleted rather than kept "to be safe" — `revalidatePath("/", "layout")` is
   * a blanket invalidation of every layout in the app, which is a real cost to
   * pay for a line nothing can justify.
   */
  revalidatePath("/settings");

  return { status: "success", error: null };
}

/**
 * Mark the first-visit Farah hint as dismissed, for this user, for good.
 *
 * NO FORM STATE AND NO RETURN VALUE, deliberately. The hint hides itself
 * optimistically the moment it is clicked, because the thing being persisted is
 * "do not show this again" — if the write fails, the correct experience is
 * still that the hint goes away now, and the worst case is that it appears once
 * more on the next visit. Surfacing an error banner over a piece of dismissed
 * chrome would be louder than the chrome.
 *
 * `farah_hint_dismissed_at` is one of the columns 0030's grant list allows an
 * authenticated user to write (widened by 0066, with the reasoning there). It
 * carries no money, trust or identity, so scoping this to the session user is
 * about correctness rather than containment: without `.eq("id", user.id)` a
 * user could clear someone else's hint, which RLS already prevents, and the
 * explicit filter is what makes that obvious to the next reader.
 */
export async function dismissFarahHintAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("profiles")
    .update({ farah_hint_dismissed_at: new Date().toISOString() })
    .eq("id", user.id);

  // Logged, not thrown, and not silently dropped either. A Supabase update
  // that is refused RESOLVES with an error rather than throwing — the failure
  // mode this repo has scar tissue about — so the check has to be explicit
  // even where the consequence is only that a hint reappears.
  if (error) console.error("[farah-hint] could not persist dismissal:", error.message);
}
