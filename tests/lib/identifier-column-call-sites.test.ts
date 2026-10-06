/**
 * The call sites that read the four tables 0232 narrows (organizations, scholarships, blog_posts, mentorship_reviews), run against a client that
 * answers the way the API roles will once 0232 is applied (tests/support/fake-grants-client.ts): a select of `*`, an embed `organizations(*)`, or a
 * withheld column is refused 42501; a list of readable columns returns exactly those columns.
 *
 * Each case asserts REAL ROWS COME BACK with the fields the page renders, not only that no error was raised: a loader that swallowed the refusal
 * and returned an empty list would pass "no error" and fail here. This is the code-first half of 0232; the database half (every column's grant,
 * both roles) is the migration pull request's tests/rls/identifier-column-grants.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grantsClient, refusalFor, splitSelectList, WITHHELD } from "../support/fake-grants-client";

const SCHOLARSHIP_ROW = {
  id: "sch-1",
  provider: "DAAD",
  program_name: "Helmut Schmidt Programme",
  host_institution: "University of Hamburg",
  degree_levels: ["msc"],
  field_tags: ["economics"],
  funding_type: "full",
  funding_covers: ["tuition"],
  eligibility_nationalities: ["Nigeria"],
  eligibility_prior_degree: null,
  eligibility_age: null,
  eligibility_other: null,
  application_deadline: "2099-01-31",
  close_time: null,
  close_tz: null,
  close_at: null,
  deadline_note: null,
  deadline_verified_at: "2026-09-01T00:00:00Z",
  cycle_year: 2099,
  official_url: "https://example.org/apply",
  source_name: "daad.de",
  moderation_status: "verified",
  dedup_fingerprint: "fp-1",
  last_checked_at: "2026-10-01T00:00:00Z",
  moderated_at: "2026-09-01T00:00:00Z",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  // the two withheld columns hold real values, so a loader that gets them back has leaked them
  moderation_note: "INTERNAL NOTE",
  moderated_by: "00000000-0000-0000-0000-0000000000aa",
};

describe("the grants fake itself (so a fake that can only say yes cannot pass)", () => {
  it("refuses *, an empty list, a withheld column, a withheld column inside an embed, and a bare (*) embed", () => {
    expect(refusalFor("scholarships", "*")?.code).toBe("42501");
    expect(refusalFor("scholarships", undefined)?.code).toBe("42501");
    expect(refusalFor("scholarships", "id, moderation_note")?.code).toBe("42501");
    // organization_members is not narrowed, but an embed of organizations inside its select list is read as the caller
    expect(refusalFor("organization_members", "role, organizations(*)")?.code).toBe("42501");
    expect(refusalFor("organization_members", "role, organizations(id, cac_number)")?.code).toBe("42501");
    expect(refusalFor("organization_members", "role, organizations(id, name, verified)")).toBeNull();
  });

  it("allows a list of readable columns, and a count with head", () => {
    expect(refusalFor("scholarships", "id, program_name, application_deadline")).toBeNull();
    expect(refusalFor("blog_posts", "slug, title, body")).toBeNull();
    expect(refusalFor("mentorship_reviews", "rating")).toBeNull();
  });

  it("splits a select list only at top-level commas", () => {
    expect(splitSelectList("a, b(c, d), e")).toEqual(["a", "b(c, d)", "e"]);
  });

  it("also refuses a withheld column used as a filter or sort, and answers an allowed read with only the named columns", async () => {
    const db = grantsClient({ scholarships: [SCHOLARSHIP_ROW] });
    const filtered = await (db.from("scholarships") as { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ error: { code: string } | null }> } }).select("id").eq("moderated_by", "x");
    expect(filtered.error?.code).toBe("42501");
    const ok = await (db.from("scholarships") as { select: (c: string) => PromiseLike<{ data: Array<Record<string, unknown>>; error: unknown }> }).select("id, program_name");
    expect(ok.data[0]).toEqual({ id: "sch-1", program_name: "Helmut Schmidt Programme" });
  });

  it("the withheld lists name the eleven columns 0232 withholds", () => {
    expect(Object.values(WITHHELD).flat().sort()).toEqual(
      ["cac_business_name", "cac_confirmed_by", "cac_number", "created_by", "created_by", "moderated_by", "moderation_note", "reviewer_id", "session_id", "updated_by"].sort(),
    );
  });
});

describe("scholarship landing pages (signed-out visitors) read real rows under the new grants", () => {
  it("loadFullyFundedScholarships returns the listing, with the fields the page renders, and not the moderation trail", async () => {
    const { loadFullyFundedScholarships } = await import("@/lib/seo/landing-page-data");
    const db = grantsClient({ scholarships: [SCHOLARSHIP_ROW] });
    const result = await loadFullyFundedScholarships(db as never);
    expect(result.total).toBe(1);
    expect(result.scholarships).toHaveLength(1);
    expect(result.scholarships[0].program_name).toBe("Helmut Schmidt Programme");
    expect(result.scholarships[0].funding_covers).toEqual(["tuition"]);
    expect(result.scholarships[0].eligibility_nationalities).toEqual(["Nigeria"]);
    expect(result.scholarships[0]).not.toHaveProperty("moderation_note");
    expect(result.scholarships[0]).not.toHaveProperty("moderated_by");
    expect(db.log.every((q) => q.refusal === null)).toBe(true);
  });

  it("loadScholarshipsByLevel returns the listing for a degree level", async () => {
    const { loadScholarshipsByLevel } = await import("@/lib/seo/landing-page-data");
    const db = grantsClient({ scholarships: [SCHOLARSHIP_ROW] });
    const result = await loadScholarshipsByLevel(db as never, "msc");
    expect(result?.scholarships.map((s) => s.program_name)).toEqual(["Helmut Schmidt Programme"]);
    expect(result?.scholarships[0]).not.toHaveProperty("moderation_note");
    expect(db.log.every((q) => q.refusal === null)).toBe(true);
  });

  it("the preview rows and the public detail page already read only named columns and keep working", async () => {
    const { loadOpenScholarshipsPreview } = await import("@/lib/seo/landing-page-data");
    const { loadPublicScholarship } = await import("@/lib/scholarships/public");
    const db = grantsClient({ scholarships: [SCHOLARSHIP_ROW] });
    const preview = await loadOpenScholarshipsPreview(db as never, 4);
    expect(preview.map((p) => p.program_name)).toEqual(["Helmut Schmidt Programme"]);
    const detail = await loadPublicScholarship("sch-1", db as never);
    expect(detail?.program_name).toBe("Helmut Schmidt Programme");
    expect(db.log.every((q) => q.refusal === null)).toBe(true);
  });
});

describe("the employer's own organisation under the new grants", () => {
  const ORG = {
    id: "org-1",
    name: "Zaria Digital",
    domain: "zariadigital.example",
    description: "A company",
    logo_url: null,
    verified: true,
    cac_confirmed_at: null,
    claim_review_dismissed_at: null,
    verification_reminder_48h_sent_at: null,
    verification_reminder_7d_sent_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    // withheld on the real table
    cac_number: "RC123456",
    cac_business_name: "Zaria Digital Ltd",
    cac_confirmed_by: "00000000-0000-0000-0000-0000000000bb",
    created_by: "00000000-0000-0000-0000-0000000000cc",
  };

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/auth/require-user");
  });

  it("getEmployerContext returns the membership WITH the organisation (id, name, verified ...) and without the withheld columns", async () => {
    const db = grantsClient({
      organization_members: [{ role: "owner", created_at: "2026-09-01T00:00:00Z", organization_id: "org-1", organizations: ORG }],
    });
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => db }));
    vi.doMock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "u1", email: "o@zariadigital.example", email_confirmed_at: "2026-09-01" } }) }));
    const { getEmployerContext } = await import("@/lib/employer/membership");
    const context = await getEmployerContext();
    expect(context, "the lookup was refused or returned nothing: every employer page would bounce to onboarding or throw").not.toBeNull();
    expect(context!.organization.id).toBe("org-1");
    expect(context!.organization.name).toBe("Zaria Digital");
    expect(context!.organization.verified).toBe(true);
    expect(context!.organization.domain).toBe("zariadigital.example");
    expect(context!.organization).not.toHaveProperty("cac_number");
    expect(context!.organization).not.toHaveProperty("created_by");
    expect(db.log.every((q) => q.refusal === null)).toBe(true);
  });

  it("the employer's company-registration details are read through the service role for that organisation only", async () => {
    const seen: Array<{ table: string; select: string; eq: Array<[string, unknown]> }> = [];
    const service = {
      from(table: string) {
        const entry = { table, select: "", eq: [] as Array<[string, unknown]> };
        seen.push(entry);
        const chain: Record<string, unknown> = {
          select: (cols: string) => ((entry.select = cols), chain),
          eq: (c: string, v: unknown) => (entry.eq.push([c, v]), chain),
          maybeSingle: async () => ({ data: { cac_number: ORG.cac_number, cac_business_name: ORG.cac_business_name }, error: null }),
        };
        return chain;
      },
    };
    vi.doMock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => service }));
    const { loadOrganizationCacDetails } = await import("@/lib/employer/cac-details");
    const details = await loadOrganizationCacDetails("org-1");
    expect(details).toEqual({ cacNumber: "RC123456", cacBusinessName: "Zaria Digital Ltd" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ table: "organizations", select: "cac_number, cac_business_name", eq: [["id", "org-1"]] });
    vi.doUnmock("@/lib/supabase/service-role");
  });
});
