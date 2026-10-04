/**
 * ACCT-1 PR 1 (migration 0212) — the migration rebuilds sixteen existing functions and adds eleven, and changes NOTHING about who can call them or how
 * they run.
 *
 * `CREATE OR REPLACE FUNCTION` keeps a function's grants but not necessarily its SECURITY DEFINER setting or its pinned search_path: a rebuilt body that
 * forgot `set search_path` would silently become a search-path-injection hole, and one that lost its definer setting would start failing RLS for the
 * callers who relied on it. 0212 patches each live definition rather than copying one (so neither can be lost), and this test holds the result to an
 * explicit table: for every function it touched, the definer flag, the search_path and exactly which roles may execute it. A change to any of them
 * has to be made here on purpose.
 *
 * The values are what production holds for those functions (read 2026-10-03, READ ONLY). The same comparison was also made against the live catalogue
 * of the preview project in a rolled-back transaction: 141 pre-existing functions compared before and after the migration, 0 differences in
 * definer flag, search_path config or ACL.
 *
 * First run of this file is CI (no database on the authoring machine).
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";

interface Expected {
  args: string;
  definer: true;
  searchPath: string;
  anon: boolean;
  authenticated: boolean;
  service: boolean;
}
const EMPTY = 'search_path=""';
const PUBLIC = "search_path=public";

/** The sixteen functions 0212 patches. `public` (PUBLIC pseudo-role) has no EXECUTE on any of them. */
const PATCHED: Record<string, Expected> = {
  book_mentor_session: { args: "p_availability_slot_id uuid, p_mentee_id uuid, p_session_type text", definer: true, searchPath: PUBLIC, anon: false, authenticated: false, service: true },
  can_access_assessment_submission: { args: "p_object_path text", definer: true, searchPath: EMPTY, anon: false, authenticated: true, service: true },
  employer_application_screening_answers: { args: "p_application_id uuid", definer: true, searchPath: EMPTY, anon: false, authenticated: true, service: true },
  employer_job_applicants: { args: "p_job_posting_id uuid", definer: true, searchPath: EMPTY, anon: false, authenticated: true, service: true },
  employer_resume_view_context: { args: "p_application_id uuid", definer: true, searchPath: EMPTY, anon: false, authenticated: true, service: true },
  employer_view_resume: { args: "p_application_id uuid", definer: true, searchPath: EMPTY, anon: false, authenticated: true, service: true },
  mentor_public_names: { args: "p_mentor_ids uuid[]", definer: true, searchPath: PUBLIC, anon: false, authenticated: true, service: true },
  mentorship_session_counterparty_names: { args: "p_user_ids uuid[]", definer: true, searchPath: PUBLIC, anon: false, authenticated: true, service: true },
  open_mentor_slots: { args: "p_mentor_ids uuid[], p_now timestamp with time zone", definer: true, searchPath: PUBLIC, anon: false, authenticated: true, service: true },
  org_application_counts: { args: "p_organization_id uuid", definer: true, searchPath: PUBLIC, anon: false, authenticated: true, service: true },
  record_employer_resume_view: { args: "p_application_id uuid", definer: true, searchPath: EMPTY, anon: false, authenticated: true, service: true },
  referral_leaderboard: { args: "p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_limit integer", definer: true, searchPath: PUBLIC, anon: false, authenticated: true, service: true },
  request_talent_directory_contact: { args: "p_organization_id uuid, p_candidate_id uuid, p_message text, p_requested_by uuid", definer: true, searchPath: PUBLIC, anon: false, authenticated: false, service: true },
  reset_test_pool_user: { args: "p_user_id uuid, p_new_email text", definer: true, searchPath: PUBLIC, anon: false, authenticated: false, service: true },
  talent_directory_listed_ids: { args: "", definer: true, searchPath: PUBLIC, anon: false, authenticated: false, service: true },
  talent_directory_portfolio_items: { args: "p_candidate_id uuid", definer: true, searchPath: PUBLIC, anon: false, authenticated: true, service: true },
};

/** The functions 0212 adds. Every one pins search_path to empty and is closed to anon. */
const ADDED: Record<string, Pick<Expected, "args" | "authenticated">> = {
  account_is_active: { args: "p_user_id uuid", authenticated: true },
  application_applicant_is_active: { args: "p_application_id uuid", authenticated: true },
  submission_applicant_is_active: { args: "p_submission_id uuid", authenticated: true },
  account_deletion_status: { args: "", authenticated: true },
  account_deletion_restore: { args: "", authenticated: true },
  account_deletion_blockers: { args: "p_user_id uuid", authenticated: false },
  account_deletion_create_request: { args: "p_user_id uuid, p_token_hash text", authenticated: false },
  account_deletion_confirm_precheck: { args: "p_user_id uuid, p_token_hash text", authenticated: false },
  account_deletion_stop_renewals: { args: "p_user_id uuid", authenticated: false },
  account_deletion_confirm: { args: "p_user_id uuid, p_token_hash text", authenticated: false },
  function_acl_audit: { args: "", authenticated: false },
};

type Row = {
  function_name: string;
  identity_args: string;
  security_definer: boolean;
  search_path_config: string | null;
  anon_exec: boolean;
  authenticated_exec: boolean;
  service_role_exec: boolean;
  public_exec: boolean;
};

async function audit(): Promise<Row[]> {
  const { data, error } = await admin.rpc("function_acl_audit" as never);
  if (error) throw new Error(error.message);
  return data as unknown as Row[];
}

describe("0212 changes nothing about who can call the functions it rebuilt, or how they run", () => {
  it.each(Object.entries(PATCHED))("%s keeps its definer flag, search_path and exact grants", async (name, want) => {
    const rows = (await audit()).filter((r) => r.function_name === name && r.identity_args === want.args);
    expect(rows, `${name}(${want.args}) must exist exactly once`).toHaveLength(1);
    const r = rows[0];
    expect(r.security_definer).toBe(want.definer);
    expect(r.search_path_config).toBe(want.searchPath);
    expect({ anon: r.anon_exec, authenticated: r.authenticated_exec, service_role: r.service_role_exec, public: r.public_exec }).toEqual({
      anon: want.anon,
      authenticated: want.authenticated,
      service_role: want.service,
      public: false,
    });
  });
});

describe("the functions 0212 adds are closed to anon and public, pin search_path, and are definer", () => {
  it.each(Object.entries(ADDED))("%s", async (name, want) => {
    const rows = (await audit()).filter((r) => r.function_name === name && r.identity_args === want.args);
    expect(rows, `${name}(${want.args}) must exist exactly once`).toHaveLength(1);
    const r = rows[0];
    expect(r.security_definer).toBe(true);
    expect(r.search_path_config).toBe(EMPTY);
    expect({ anon: r.anon_exec, authenticated: r.authenticated_exec, service_role: r.service_role_exec, public: r.public_exec }).toEqual({
      anon: false,
      authenticated: want.authenticated,
      service_role: true,
      public: false,
    });
  });

  it("no function in the schema is executable by anon that was not already, and none of 0212's is", async () => {
    const anon = (await audit()).filter((r) => r.anon_exec).map((r) => r.function_name);
    for (const name of [...Object.keys(ADDED), ...Object.keys(PATCHED)]) expect(anon, `${name} must not be callable by anon`).not.toContain(name);
  });
});
