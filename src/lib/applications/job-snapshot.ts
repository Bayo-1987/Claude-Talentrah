import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface ManualJobSnapshot {
  companyName: string;
  title: string;
  url?: string;
  location?: string;
  // Structural, not incidental: this is what lets an object typed as
  // ManualJobSnapshot satisfy Supabase's generated `Json` column type
  // directly at the insert/update call site, with no cast.
  [key: string]: string | undefined;
}

/**
 * Denormalized onto an `applications` row at write time, in the EXACT shape
 * addManualEntryAction (tracker-actions.ts) already writes for a manually-
 * entered tracker item — {companyName, title, url, location}. That shape
 * already has a reader: the Job Tracker (src/app/(app)/tracker/page.tsx)
 * falls back to it whenever `job_postings` is absent (`job?.title ??
 * snapshot?.title`), which today only happens for a manual entry with no
 * `job_posting_id` at all.
 *
 * Writing this snapshot on every save/apply against a REAL posting — not
 * just manual entries — means an `applications` row survives its linked
 * posting being deleted later (the not-yet-built Stage 5b) with zero
 * rendering changes needed: the row just starts looking like a manual entry
 * to the same code that already handles one. `job_posting_id` itself stays
 * set until (and unless) that deletion job nulls it — this only ever adds
 * data, it never stops the row from also joining to the real posting today.
 */
export async function loadJobSnapshot(
  supabase: SupabaseClient<Database>,
  jobPostingId: string,
): Promise<ManualJobSnapshot | null> {
  const { data } = await supabase
    .from("job_postings")
    .select("title, company_name, location, external_url")
    .eq("id", jobPostingId)
    .maybeSingle();
  if (!data) return null;
  return {
    companyName: data.company_name,
    title: data.title,
    location: data.location || undefined,
    url: data.external_url || undefined,
  };
}
