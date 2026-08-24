/**
 * Seed/demo data per build-prompt §11: a fake org with internal postings, a
 * demo user with a base resume, and real external jobs pulled through the
 * actual ingestion pipeline — via its real HTTP route (not a direct import;
 * src/lib/jobs/ingest.ts pulls in "server-only" guards that only resolve
 * correctly inside Next's own runtime, not a plain tsx/node process), so
 * this also doubles as an end-to-end check that the pipeline works.
 *
 * Requires the dev server running (npm run dev) for the ingestion step.
 * Run with: npm run seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { computeDedupFingerprint } from "../src/lib/jobs/dedup";
import { extractStructuredJd } from "../src/lib/jobs/extract-jd";

const DEMO_EMAIL = "demo@talentrah.dev";
const DEMO_PASSWORD = "TalentrahDemo123!";

const INTERNAL_JOBS = [
  {
    title: "Senior Product Manager",
    location: "Lagos, Nigeria",
    work_type: "hybrid" as const,
    employment_type: "full_time" as const,
    seniority: "senior" as const,
    description:
      "Own the roadmap for Zaria Digital's merchant dashboard, working closely with engineering, design, and data on a weekly ship cadence. You'll drive product strategy for our core payments product, partner with data and engineering on activation and retention experiments, and represent the voice of the customer in every planning cycle.",
  },
  {
    title: "Backend Engineer (Node.js)",
    location: "Lagos, Nigeria",
    work_type: "remote" as const,
    employment_type: "full_time" as const,
    seniority: "mid" as const,
    description:
      "Build and maintain the services powering Zaria Digital's payments infrastructure. You'll work with Node.js, TypeScript, and PostgreSQL to ship reliable, well-tested APIs, and collaborate with product and design to turn requirements into shipped features.",
  },
  {
    title: "Customer Success Associate",
    location: "Remote",
    work_type: "remote" as const,
    employment_type: "full_time" as const,
    seniority: "entry" as const,
    description:
      "Be the first point of contact for Zaria Digital's merchants — onboarding new customers, resolving support tickets, and surfacing product feedback to the team. Great communication skills and a genuine interest in small-business customers required.",
  },
];

const DEMO_RESUME = {
  contact: {
    name: "Demo Seeker",
    email: DEMO_EMAIL,
    location: "Lagos, Nigeria",
  },
  summary:
    "Product-minded operator with 4 years across fintech and payments, focused on activation, retention, and merchant experience.",
  experience: [
    {
      title: "Product Manager",
      company: "Fintech Co",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Led product strategy for a merchant payments dashboard, driving stakeholder alignment across compliance, ops, and executive leadership.",
    },
    {
      title: "Associate Product Manager",
      company: "Payments Startup",
      location: "Lagos, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description: "Owned onboarding and activation experiments for SMB merchants.",
    },
  ],
  education: [
    { school: "University of Lagos", degree: "B.Sc.", field: "Computer Science" },
  ],
  skills: [
    "product management",
    "stakeholder management",
    "sql",
    "agile",
    "data analysis",
    "figma",
  ],
  projects: [],
  certifications: [],
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
    );
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("→ Creating demo user…");
  let userId: string;
  const { data: existing } = await supabase.auth.admin.listUsers();
  const existingUser = existing.users.find((u) => u.email === DEMO_EMAIL);

  if (existingUser) {
    userId = existingUser.id;
    console.log(`  already exists (${userId})`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        first_name: "Demo",
        last_name: "Seeker",
        country: "Nigeria",
      },
    });
    if (error || !data.user) throw error ?? new Error("Failed to create demo user");
    userId = data.user.id;
    console.log(`  created (${userId})`);
  }

  console.log("→ Seeding base resume…");
  // Mirrors src/lib/resume/upsert-base-resume.ts's replace-in-place logic —
  // can't import that module directly, since it (like the rest of
  // src/lib/resume) is "server-only"-guarded and this script runs via plain
  // tsx/node, not Next's runtime (same constraint noted above for the
  // ingestion pipeline). The DB's unique partial index on
  // resumes(user_id) where is_base=true is what actually guarantees this
  // can't produce a duplicate either way.
  const { data: existingBase } = await supabase
    .from("resumes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();

  if (existingBase) {
    await supabase
      .from("resumes")
      .update({ title: "My resume", source: "builder", structured_content: DEMO_RESUME })
      .eq("id", existingBase.id);
  } else {
    await supabase.from("resumes").insert({
      user_id: userId,
      is_base: true,
      title: "My resume",
      source: "builder",
      structured_content: DEMO_RESUME,
    });
  }

  console.log("→ Seeding demo organization…");
  const ORG_NAME = "Zaria Digital";
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("name", ORG_NAME)
    .maybeSingle();

  let org = existingOrg;
  if (!org) {
    const { data: newOrg, error: orgError } = await supabase
      .from("organizations")
      .insert({
        name: ORG_NAME,
        domain: "zariadigital.example",
        verified: true,
        description:
          "A fictional Lagos-based fintech, seeded for demo purposes — builds payments tools for African SMBs.",
        created_by: userId,
      })
      .select("id")
      .single();
    if (orgError || !newOrg) throw orgError ?? new Error("Failed to create demo org");
    org = newOrg;
  }

  await supabase
    .from("organization_members")
    .upsert(
      { organization_id: org.id, user_id: userId, role: "owner" },
      { onConflict: "organization_id,user_id" },
    );

  console.log("→ Seeding internal job postings…");
  for (const job of INTERNAL_JOBS) {
    await supabase.from("job_postings").upsert(
      {
        source_type: "internal",
        organization_id: org.id,
        title: job.title,
        company_name: ORG_NAME,
        location: job.location,
        work_type: job.work_type,
        employment_type: job.employment_type,
        seniority: job.seniority,
        description: job.description,
        structured_jd: JSON.parse(JSON.stringify(extractStructuredJd(job.description))),
        status: "open",
        posted_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        dedup_fingerprint: computeDedupFingerprint(ORG_NAME, job.title, job.location),
      },
      { onConflict: "dedup_fingerprint" },
    );
  }

  console.log("→ Seeding Job Tracker demo entries…");
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  const { data: internalJobs } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("organization_id", org.id);
  const jobIdByTitle = new Map((internalJobs ?? []).map((j) => [j.title, j.id]));

  async function upsertLinkedApplication(
    title: string,
    stage: Database["public"]["Enums"]["application_stage"],
    source: "manual" | "internal_apply",
    appliedDaysAgo: number | null,
  ) {
    const jobId = jobIdByTitle.get(title);
    if (!jobId) return;
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle();
    const payload = {
      user_id: userId,
      job_posting_id: jobId,
      stage,
      source,
      applied_at: appliedDaysAgo === null ? null : daysAgo(appliedDaysAgo),
    };
    if (existing) {
      await supabase.from("applications").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(payload);
    }
  }

  async function upsertManualApplication(
    companyName: string,
    title: string,
    location: string,
    stage: Database["public"]["Enums"]["application_stage"],
    appliedDaysAgo: number,
    notes: string,
  ) {
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .is("job_posting_id", null)
      .eq("manual_job_snapshot->>title", title)
      .maybeSingle();
    const payload = {
      user_id: userId,
      job_posting_id: null,
      manual_job_snapshot: { companyName, title, location },
      stage,
      source: "manual" as const,
      applied_at: daysAgo(appliedDaysAgo),
      notes,
    };
    if (existing) {
      await supabase.from("applications").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(payload);
    }
  }

  await upsertLinkedApplication("Customer Success Associate", "saved", "manual", null);
  await upsertLinkedApplication("Backend Engineer (Node.js)", "applied", "internal_apply", 10);
  await upsertLinkedApplication("Senior Product Manager", "interviewing", "internal_apply", 15);
  await upsertManualApplication(
    "Flutterwave",
    "Growth Product Manager",
    "Lagos, Nigeria",
    "offer",
    20,
    "Final round went well — awaiting paperwork.",
  );
  await upsertManualApplication(
    "Paystack",
    "Backend Engineer",
    "Lagos, Nigeria",
    "hired",
    40,
    "Accepted! Starts next month.",
  );
  await upsertManualApplication(
    "Interswitch",
    "Software Engineer",
    "Lagos, Nigeria",
    "rejected",
    25,
    "Didn't move forward after the technical screen.",
  );

  console.log("→ Running real ingestion pipeline for external jobs…");
  const devServerUrl = process.env.SEED_APP_URL ?? "http://localhost:3000";
  const ingestRes = await fetch(`${devServerUrl}/api/admin/ingest-jobs`, {
    method: "POST",
    headers: process.env.INGEST_SECRET
      ? { "x-ingest-secret": process.env.INGEST_SECRET }
      : {},
  });
  if (!ingestRes.ok) {
    throw new Error(
      `Ingestion route returned ${ingestRes.status} — is \`npm run dev\` running at ${devServerUrl}?`,
    );
  }
  const { results } = (await ingestRes.json()) as {
    results: { source: string; token: string; fetched: number; upserted: number; closed: number; error?: string }[];
  };
  for (const r of results) {
    if (r.error) {
      console.log(`  ✗ ${r.source}/${r.token}: ${r.error}`);
    } else {
      console.log(
        `  ✓ ${r.source}/${r.token}: fetched ${r.fetched}, upserted ${r.upserted}, closed ${r.closed}`,
      );
    }
  }

  console.log("\nDone. Demo login:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
