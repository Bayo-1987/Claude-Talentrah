export interface ResumeExperienceEntry {
  title: string;
  company: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface ResumeEducationEntry {
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

export interface StructuredResume {
  contact: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  summary?: string;
  experience: ResumeExperienceEntry[];
  education: ResumeEducationEntry[];
  skills: string[];
  projects: string[];
  certifications: string[];
}

export const EMPTY_RESUME: StructuredResume = {
  contact: {},
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
};

export interface ParseResult {
  resume: StructuredResume;
  confidence: "high" | "low";
  usedFallback: boolean;
}
