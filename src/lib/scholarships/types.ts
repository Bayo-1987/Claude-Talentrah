import type { Enums } from "@/lib/supabase/types";

export type DegreeLevel = Enums<"scholarship_degree_level">;
export type FundingType = Enums<"scholarship_funding_type">;
export type ModerationStatus = Enums<"scholarship_moderation_status">;
export type SaveStatus = Enums<"scholarship_save_status">;

/**
 * A listing as a source hands it over, before it's persisted — the
 * scholarship analog of src/lib/jobs/types.ts's NormalizedJobPosting.
 * Sources produce this shape; ingest.ts is the only thing that knows how to
 * turn it into a row.
 */
export interface NormalizedScholarship {
  provider: string;
  programName: string;
  hostInstitution: string | null;
  degreeLevels: DegreeLevel[];
  fieldTags: string[];
  fundingType: FundingType;
  /** Which costs the award covers — tuition / stipend / travel. */
  fundingCovers: string[];
  eligibilityNationalities: string[];
  eligibilityPriorDegree: string | null;
  eligibilityAge: string | null;
  eligibilityOther: string | null;
  /** ISO date (YYYY-MM-DD), or null when the cycle's date isn't published yet. */
  applicationDeadline: string | null;
  cycleYear: number | null;
  /** §6.15: non-negotiable — every listing must point at its primary source. */
  officialUrl: string;
  sourceName: string;
}

export const DEGREE_LEVEL_LABEL: Record<DegreeLevel, string> = {
  bsc: "BSc",
  msc: "MSc",
  phd: "PhD",
  postgraduate_diploma: "PG Diploma",
  other: "Other",
};

export const FUNDING_TYPE_LABEL: Record<FundingType, string> = {
  full: "Fully funded",
  partial: "Partially funded",
};

export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  applying: "Applying",
  submitted: "Submitted",
  outcome: "Outcome",
};
