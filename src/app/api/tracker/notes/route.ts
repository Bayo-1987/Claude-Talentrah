import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves a tracker note over a plain fetch, not a Server Action.
 *
 * The notes editor used to submit via `<form action={formAction}>` bound to a
 * `"use server"` action through `useActionState`. That dispatch has no
 * userland hook for a TRANSPORT failure (the POST itself never landing) —
 * only for an error the action's own code throws after running. When the
 * network drops the request, the rejection surfaces inside Next's own
 * internal action-dispatch machinery and becomes an uncaught rejection,
 * which the App Router turns into its default "This page couldn't load"
 * interstitial — unmounting the editor and the draft in it. Wrapping the old
 * `formAction()` call in a `try/catch` did not fix this; it happens below
 * anything exposed to the caller. A plain Route Handler reached by a plain
 * `fetch()` has none of that machinery in the way: a dead network is just a
 * rejected promise the client already awaits in its own `try/catch`.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
  if (!applicationId) {
    return NextResponse.json({ error: "Missing applicationId." }, { status: 400 });
  }
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  const updatedAt = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("applications")
    .update({ notes: notes || null, updated_at: updatedAt })
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .select("id, notes, updated_at");

  if (error) {
    // Not echoed verbatim: a Postgres string here would describe our columns
    // and policies to whoever provoked it. The detail goes to the log.
    console.error("[tracker:updateNotes]", error);
    return NextResponse.json(
      { error: "Couldn't save that note. Your text is still here — try again." },
      { status: 500 },
    );
  }

  // Zero rows is not an error and not a success: the entry was deleted, or it
  // was never this user's.
  if (!updated?.length) {
    revalidatePath("/tracker");
    return NextResponse.json({ error: "That entry is no longer in your tracker." }, { status: 404 });
  }

  revalidatePath("/tracker");
  return NextResponse.json({ notes: updated[0].notes, updatedAt: updated[0].updated_at });
}
