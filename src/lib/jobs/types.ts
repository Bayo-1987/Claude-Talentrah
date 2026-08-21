export type WorkType = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type SeniorityLevel = "entry" | "mid" | "senior" | "lead" | "executive";

export interface StructuredJD {
  skills: string[];
  keywords: string[];
  responsibilities: string[];
}

export interface NormalizedJobPosting {
  title: string;
  companyName: string;
  companyLogoUrl?: string;
  location?: string;
  workType?: WorkType;
  employmentType?: EmploymentType;
  seniority?: SeniorityLevel;
  description: string;
  structuredJd: StructuredJD;
  externalUrl: string;
  externalSource: "greenhouse" | "lever";
  postedAt: string;
  dedupFingerprint: string;
}

export interface JobSourceConfig {
  source: "greenhouse" | "lever";
  token: string;
  companyName: string;
}
