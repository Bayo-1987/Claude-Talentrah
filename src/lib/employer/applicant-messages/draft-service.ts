import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { findMyApplicant } from "./authorize";
import { MESSAGE_TEMPLATE_KINDS, type MessageKind } from "./constants";
import { runFarahMessageDraft, type DraftMode, type DraftResult } from "./draft-core";
import { defaultDraftDeps } from "./draft-llm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "We couldn't find that applicant. Reload the page and try again.";

export type DraftRequestResult = DraftResult | { ok: false; kind: "not_found"; error: string };

export interface DraftRequestInput {
  jobId: unknown;
  applicationId: unknown;
  kind: unknown;
  mode: unknown;
  notes: unknown;
  subject: unknown;
  body: unknown;
}

/**
 * "Draft/Refine with Farah" for the signed-in employer's organisation. The route handler resolves the employer's own session and organisation and passes them in; this proves the application is an applicant on a job THAT organisation owns
 * (employer_job_applicants, its own membership check) before anything is charged, then runs the draft: Premium check, ad wallet debit, model, refund on any failure, and a refund too if the browser disconnects before the draft is delivered
 * (`signal` is the request's own). Only the job title, the organisation's name, two first names and what the employer wrote go to the model.
 */
export async function draftForEmployer(
  { supabase, userId, organization }: { supabase: SupabaseClient<Database>; userId: string; organization: { id: string; name: string } },
  input: DraftRequestInput,
  signal?: AbortSignal,
): Promise<DraftRequestResult> {
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const applicationId = typeof input.applicationId === "string" ? input.applicationId : "";
  if (!UUID.test(jobId) || !UUID.test(applicationId)) return { ok: false, kind: "not_found", error: NOT_FOUND };

  const applicant = await findMyApplicant(supabase, { organizationId: organization.id, jobId, applicationId });
  if (!applicant) return { ok: false, kind: "not_found", error: NOT_FOUND };

  const { data: sender } = await supabase.from("profiles").select("first_name").eq("id", userId).maybeSingle();
  const kind: MessageKind = typeof input.kind === "string" && (MESSAGE_TEMPLATE_KINDS as readonly string[]).includes(input.kind) ? (input.kind as MessageKind) : "custom";
  const mode: DraftMode = input.mode === "refine" ? "refine" : "draft";
  const text = (value: unknown) => (typeof value === "string" ? value : "");

  return runFarahMessageDraft(
    {
      organizationId: organization.id,
      userId,
      kind,
      mode,
      jobTitle: applicant.jobTitle,
      orgName: organization.name,
      candidateFirstName: applicant.firstName,
      senderFirstName: sender?.first_name ?? null,
      notes: text(input.notes),
      currentSubject: mode === "refine" ? text(input.subject) : "",
      currentBody: mode === "refine" ? text(input.body) : "",
      signal,
    },
    defaultDraftDeps(),
  );
}
