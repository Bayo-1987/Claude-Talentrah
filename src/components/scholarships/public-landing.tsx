import type { Tables } from "@/lib/supabase/types";

/**
 * send-480 — TESTS-FIRST STUB. Exists only so the failing tests typecheck and CI goes red on
 * behaviour rather than on a missing module. Replaced by the real component in the next commit.
 */
export interface LandingFacet {
  href: string;
  label: string;
  count: number;
}

export type LandingListing = Pick<
  Tables<"scholarships">,
  | "id"
  | "provider"
  | "program_name"
  | "host_institution"
  | "degree_levels"
  | "funding_type"
  | "application_deadline"
  | "deadline_note"
  | "official_url"
>;

export function ScholarshipsPublicLanding(props: {
  facets: LandingFacet[];
  listings: LandingListing[];
  listingsError?: boolean;
}): never {
  void props;
  throw new Error("not implemented");
}
