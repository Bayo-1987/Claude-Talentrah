import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role client — bypasses RLS entirely. Only for trusted server-side
 * code that legitimately needs to write to owner-only tables on a user's
 * behalf: the Paystack webhook handler (credit_ledger, user_passes,
 * payment_transactions), the aggregation pipeline (job_postings), and match
 * scoring jobs. Never import this into a Client Component or expose the key
 * to the browser.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
