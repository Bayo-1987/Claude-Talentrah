import { createRoot } from "react-dom/client";
import { JobCard, type JobCardProps } from "@/components/jobs/job-card";

/**
 * The REAL JobCard, bundled with the app's real compiled stylesheet, in the shell's own wrapper structure (a content column beside the Farah panel from 760px up). Three cards, one per
 * kind of action row the card draws: an in-app job (Apply), an external job (Mark as applied + Apply on company site) and an internal job already applied to. Server Actions are stubs.
 * No app server, no login and no database: it runs the same everywhere.
 */
const explanation = { matchedSkills: ["react", "sql"], missingSkills: ["aws"], seniorityAlignment: "match" as const };

const base: JobCardProps["job"] = {
  id: "00000000-0000-4000-8000-000000000001",
  source_type: "internal",
  organization_id: "00000000-0000-4000-8000-0000000000aa",
  title: "Senior Backend Engineer (Payments Platform)",
  company_name: "Moniepoint Microfinance Bank",
  company_logo_url: null,
  location: "Lagos, Nigeria",
  work_type: "hybrid",
  employment_type: "full_time",
  seniority: "senior",
  years_experience_min: 5,
  description: "Build and run the services that move money for small businesses across Nigeria, with a team that ships weekly.",
  structured_jd: { skills: ["react", "sql", "aws"] },
  external_url: null,
  external_source: null,
  status: "open",
  posted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  last_checked_at: null,
  dedup_fingerprint: "harness",
  created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  expires_at: null,
  removed_at: null,
  removal_reason: null,
  removed_by: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_unit: null,
  import_feed_id: null,
  external_source_id: null,
} as unknown as JobCardProps["job"];

const common = { score: 82, isSaved: false, explanation, origin: "http://harness.test", countryState: "none", hasBaseResume: true } as unknown as Omit<JobCardProps, "job" | "applicationStage">;

function Page() {
  const external = { ...base, id: "00000000-0000-4000-8000-000000000002", source_type: "external", organization_id: null, external_source: "greenhouse", external_url: "https://example.test/jobs/2" } as JobCardProps["job"];
  const applied = { ...base, id: "00000000-0000-4000-8000-000000000003" } as JobCardProps["job"];
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto flex w-full max-w-[1360px] flex-col min-[760px]:flex-row">
        <div data-testid="content-column" className="min-w-0 flex-1 px-6 py-8 min-[760px]:px-10">
          <div className="flex flex-col gap-4">
            <div data-testid="card-internal"><JobCard {...common} job={base} applicationStage={null} /></div>
            <div data-testid="card-external"><JobCard {...common} job={external} applicationStage={null} /></div>
            <div data-testid="card-applied"><JobCard {...common} job={applied} applicationStage="applied" /></div>
          </div>
        </div>
        <aside className="hidden w-[280px] shrink-0 border-l border-line min-[760px]:block" aria-hidden="true" />
      </main>
    </div>
  );
}

declare global {
  interface Window {
    __mountJobCards: () => void;
  }
}
window.__mountJobCards = () => {
  const el = document.getElementById("root");
  if (!el) throw new Error("no root");
  createRoot(el).render(<Page />);
};
