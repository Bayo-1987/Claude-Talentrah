import type { Tables } from "@/lib/supabase/types";

/**
 * Every column of `organizations` that the signed-in and signed-out roles can read: the whole row except the company-registration details
 * (`cac_number`, `cac_business_name`), who confirmed them (`cac_confirmed_by`) and who created the organisation (`created_by`), which migration 0232
 * withholds from them. The employer's own registration details are read on the server, for their own organisation only, by
 * src/lib/employer/cac-details.ts.
 *
 * The same list is written out as a literal inside the `organizations(...)` embed in src/lib/employer/membership.ts, because supabase-js reads the
 * result type from the literal text of `select(...)`; tests/lib/identifier-columns-readable-lists.test.ts checks that literal, this constant and the
 * generated types all agree.
 */
export const ORGANIZATION_READABLE_COLUMNS =
  "id, name, domain, description, logo_url, verified, cac_confirmed_at, claim_review_dismissed_at, verification_reminder_48h_sent_at, verification_reminder_7d_sent_at, created_at, updated_at";

/** An organisation row as the signed-in role sees it: every column but the registration details and the creator's id. */
export type OrganizationRow = Omit<Tables<"organizations">, "cac_number" | "cac_business_name" | "cac_confirmed_by" | "created_by">;
