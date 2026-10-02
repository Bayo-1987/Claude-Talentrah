import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type WaitlistJoinResult = "joined" | "already_joined";

/**
 * Puts an organisation on the Talent Directory waitlist (0205). Free: it touches no payment table and no subscription row.
 *
 * IDEMPOTENT PER ORGANISATION, decided by the database, not by a read-then-write here: the table is UNIQUE on organization_id and this
 * inserts with ON CONFLICT DO NOTHING, so two concurrent clicks (or two colleagues) leave one row and the loser gets "already_joined"
 * instead of an error. The first joiner stays recorded in `joined_by`; a later join never overwrites it.
 *
 * Takes the client as a parameter so the service-role caller is explicit: the table has no client grants at all (0205).
 */
export async function joinTalentDirectoryWaitlist(
  client: SupabaseClient<Database>,
  input: { organizationId: string; userId: string },
): Promise<WaitlistJoinResult> {
  const { data, error } = await client
    .from("talent_directory_waitlist")
    .upsert(
      { organization_id: input.organizationId, joined_by: input.userId },
      { onConflict: "organization_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  return data && data.length > 0 ? "joined" : "already_joined";
}

export async function isOnTalentDirectoryWaitlist(
  client: SupabaseClient<Database>,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("talent_directory_waitlist")
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
