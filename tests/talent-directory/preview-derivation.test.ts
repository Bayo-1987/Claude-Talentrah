/**
 * EMP-1 / E1 — the anonymisation rules of talent_directory_preview, tested against the real SQL.
 *
 * ── WHY RE-IDENTIFICATION IS THE WHOLE PROBLEM ─────────────────────────────
 * Production has ONE verified, opted-in candidate. A "sample card" built from that person's real role, real skills and real years is not
 * an anonymised sample, it is their profile with the name removed: anyone who knows them can recognise it. So the rules are k-anonymity
 * rules, with k = 3, and they are enforced INSIDE the database function (an employer's session can call the RPC directly, so a page-side
 * filter would protect nothing):
 *
 *   1. No samples at all while fewer than 3 candidates are listed.
 *   2. Role is a coarse FAMILY ("Engineering", "Design"...) derived from the latest job title, never the title. A family is named only
 *      when at least 3 listed candidates share it; otherwise the card says "Professional".
 *   3. Years of experience are a band: 0-2, 3-5, 6-9, 10+. Never a number.
 *   4. Skills: only a skill that at least 3 listed candidates' resumes carry, at most 4 per card. A skill only one person has is the most
 *      identifying thing on a resume and never appears.
 *   5. Availability: two booleans. No location, no name, no photo, no employer, no contact detail, no id.
 *   6. At most 3 cards, picked by a hash of the id (not by recency, which would leak who joined last).
 *
 * These call `talent_directory_preview_for(p_ids)` with the service role, so the pool is exactly the fixtures: deterministic, and immune to
 * other test files creating verified candidates in the same database at the same time. The public `talent_directory_preview()` is that
 * function applied to the whole listed set (parity is pinned in tests/rls/talent-directory-preview.test.ts and the static gate test).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory preview derivation suite cannot run: ${key} is not set.`);
}

type Sample = {
  role: string;
  yearsBand: string | null;
  skills: string[];
  availableForHire: boolean;
  remoteReady: boolean;
};
type Preview = { count: number; samples: Sample[] };

async function previewFor(ids: string[]): Promise<Preview> {
  const { data, error } = await admin.rpc("talent_directory_preview_for", { p_ids: ids });
  expect(error, error?.message).toBeNull();
  return data as unknown as Preview;
}

const THIS_YEAR = new Date().getFullYear();

interface Fixture {
  id: string;
  title: string;
  startYear: number | null;
  skills: string[];
}

const fixtures: Fixture[] = [];
const createdIds: string[] = [];

async function makeCandidate(
  label: string,
  opts: { title: string; startYear: number | null; skills: string[]; verified?: boolean; optedIn?: boolean; available?: boolean; remote?: boolean },
): Promise<Fixture> {
  const user = await createTestUser(`tdprev-${label}`);
  createdIds.push(user.id);
  const { error: pErr } = await admin
    .from("profiles")
    .update({
      talent_directory_opt_in: opts.optedIn ?? true,
      talent_verification_status: (opts.verified ?? true) ? "verified" : "unverified",
      talent_verified_at: new Date().toISOString(),
      talent_available_for_hire: opts.available ?? true,
      talent_remote_ready: opts.remote ?? false,
      first_name: "Fixture",
      last_name: `Person-${label}`,
      country: "Nigeria",
    })
    .eq("id", user.id);
  expect(pErr, pErr?.message).toBeNull();
  const { error: rErr } = await admin.from("resumes").insert({
    user_id: user.id,
    is_base: true,
    title: `Fixture resume ${label}`,
    structured_content: {
      contact: { name: `Fixture Person-${label}`, email: `${label}@example.com`, phone: "+2348000000000", location: "Lagos" },
      experience: [
        {
          title: opts.title,
          company: `Employer-${label}-Ltd`,
          startDate: opts.startYear === null ? undefined : `Jan ${opts.startYear}`,
          description: "secret description text",
        },
      ],
      education: [],
      skills: opts.skills,
      projects: [],
      certifications: [],
    },
  });
  expect(rErr, rErr?.message).toBeNull();
  const f = { id: user.id, title: opts.title, startYear: opts.startYear, skills: opts.skills };
  fixtures.push(f);
  return f;
}

afterAll(async () => {
  await deleteTestUsers(createdIds);
}, 60_000);

/* ---------------------------------------------------------------------- *
 * Pure helpers: band and family edges, no users needed.
 * ---------------------------------------------------------------------- */
describe("talent_directory_years_band", () => {
  it.each([
    [0, "0-2"],
    [2, "0-2"],
    [3, "3-5"],
    [5, "3-5"],
    [6, "6-9"],
    [9, "6-9"],
    [10, "10+"],
    [35, "10+"],
  ])("%i years is %s", async (years, band) => {
    const { data, error } = await admin.rpc("talent_directory_years_band", { p_years: years });
    expect(error, error?.message).toBeNull();
    expect(data).toBe(band);
  });

  it("no years is no band, and a negative or absurd value is no band, not a guess", async () => {
    for (const v of [null, -1, 80]) {
      const { data, error } = await admin.rpc("talent_directory_years_band", { p_years: v as number });
      expect(error, error?.message).toBeNull();
      expect(data).toBeNull();
    }
  });
});

describe("talent_directory_role_family", () => {
  it.each([
    ["Senior Software Engineer", "Engineering"],
    ["Frontend Developer", "Engineering"],
    ["Data Analyst", "Data"],
    ["Machine Learning Scientist", "Data"],
    ["Product Designer", "Design"],
    ["UX Researcher", "Design"],
    ["Product Manager", "Product"],
    ["Digital Marketing Lead", "Marketing"],
    ["Sales Executive", "Sales"],
    ["Financial Controller", "Finance"],
    ["Operations Manager", "Operations"],
    ["HR Business Partner", "People"],
    ["Customer Support Specialist", "Customer"],
  ])("%s is %s", async (title, family) => {
    const { data, error } = await admin.rpc("talent_directory_role_family", { p_title: title });
    expect(error, error?.message).toBeNull();
    expect(data).toBe(family);
  });

  it("a title it cannot place, or a missing one, is null (the preview then says 'Professional')", async () => {
    for (const t of ["Chief Happiness Wizard", "", null]) {
      const { data, error } = await admin.rpc("talent_directory_role_family", { p_title: t as string });
      expect(error, error?.message).toBeNull();
      expect(data).toBeNull();
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Integration: k = 3 over a controlled pool.
 * ---------------------------------------------------------------------- */
describe("talent_directory_preview_for: k-anonymity over the pool", () => {
  let e1: Fixture, e2: Fixture, e3: Fixture, e4: Fixture, e5: Fixture, marketer: Fixture, notOptedIn: Fixture, notVerified: Fixture;

  beforeAll(async () => {
    const common = ["React", "TypeScript"];
    [e1, e2, e3, e4, e5, marketer, notOptedIn, notVerified] = await Promise.all([
      makeCandidate("e1", { title: "Senior Software Engineer", startYear: THIS_YEAR - 7, skills: [...common, "Rust"], remote: true }),
      makeCandidate("e2", { title: "Backend Developer", startYear: THIS_YEAR - 4, skills: [...common, "Haskell"], available: false }),
      makeCandidate("e3", { title: "Staff Platform Engineer", startYear: THIS_YEAR - 12, skills: [...common, "SQL", "COBOL"] }),
      makeCandidate("e4", { title: "Software Engineer", startYear: null, skills: ["SQL", "react"] }),
      makeCandidate("e5", { title: "Chief Happiness Wizard", startYear: THIS_YEAR - 1, skills: ["SQL", "typescript "] }),
      makeCandidate("mk", { title: "Chief Brand Strategist and Marketing Director", startYear: THIS_YEAR - 9, skills: ["Branding"] }),
      makeCandidate("noopt", { title: "Software Engineer", startYear: THIS_YEAR - 3, skills: ["React"], optedIn: false }),
      makeCandidate("noverif", { title: "Software Engineer", startYear: THIS_YEAR - 3, skills: ["React"], verified: false }),
    ]);
  }, 120_000);

  it("rule 1: a pool of 0, 1 or 2 listed candidates shows a count and NO samples", async () => {
    for (const ids of [[], [e1.id], [e1.id, e2.id]]) {
      const p = await previewFor(ids);
      expect(p.count).toBe(ids.length);
      expect(p.samples, `a pool of ${ids.length} must not produce a sample card`).toEqual([]);
    }
  });

  it("an id that is not listed is neither counted nor sampled (opted-in only, verified only)", async () => {
    const p = await previewFor([e1.id, e2.id, notOptedIn.id, notVerified.id]);
    expect(p.count, "count includes someone who fails the directory gate").toBe(2);
    expect(p.samples).toEqual([]);
    const withThird = await previewFor([e1.id, e2.id, e3.id, notOptedIn.id, notVerified.id]);
    expect(withThird.count).toBe(3);
    expect(withThird.samples).toHaveLength(3);
  });

  it("a pool of 3 gives 3 cards; rules 2-5 hold on every one", async () => {
    const p = await previewFor([e1.id, e2.id, e3.id]);
    expect(p.count).toBe(3);
    expect(p.samples).toHaveLength(3);
    for (const s of p.samples) {
      expect(Object.keys(s).sort()).toEqual(["availableForHire", "remoteReady", "role", "skills", "yearsBand"]);
      expect(s.role).toBe("Engineering"); // three engineers share the family
      expect(["0-2", "3-5", "6-9", "10+", null]).toContain(s.yearsBand);
      expect(s.skills.length).toBeLessThanOrEqual(4);
      // only skills three resumes carry: React and TypeScript. Rust, Haskell, SQL (2 of 3 in this pool) and COBOL never appear
      expect(s.skills.every((k) => ["react", "typescript"].includes(k))).toBe(true);
    }
    const bands = p.samples.map((s) => s.yearsBand).sort();
    expect(bands).toEqual(["10+", "3-5", "6-9"]);
    // availability flags pass through: e1 is remote-ready, e2 is not available, e3 is available and not remote-ready
    expect(p.samples.filter((s) => s.remoteReady)).toHaveLength(1);
    expect(p.samples.filter((s) => !s.availableForHire)).toHaveLength(1);
  });

  it("rule 2: a family held by fewer than 3 candidates is not named", async () => {
    const p = await previewFor([e1.id, e2.id, marketer.id]);
    expect(p.samples).toHaveLength(3);
    expect(p.samples.every((s) => s.role === "Professional"), "a one-person family was named on a card").toBe(true);
  });

  it("rule 3: years are a band computed from the earliest start year, and null when no date is parseable", async () => {
    const p = await previewFor([e1.id, e3.id, e4.id]);
    const bands = p.samples.map((s) => s.yearsBand).sort((a, b) => String(a).localeCompare(String(b)));
    expect(bands).toEqual(["10+", "6-9", null].sort((a, b) => String(a).localeCompare(String(b))));
  });

  it("rule 4: skills are normalised and counted across the pool; a skill unique to one person never appears", async () => {
    // react: e1,e2,e3,e4 (case-insensitive); typescript: e1,e2,e3,e5 (trailing space trimmed); sql: e3,e4,e5; rust/haskell/cobol: 1 each
    const p = await previewFor([e1.id, e2.id, e3.id, e4.id, e5.id]);
    expect(p.count).toBe(5);
    const all = new Set(p.samples.flatMap((s) => s.skills));
    for (const unique of ["rust", "haskell", "cobol", "branding"]) expect(all.has(unique), `${unique} is one person's skill`).toBe(false);
    for (const k of all) expect(["react", "typescript", "sql"]).toContain(k);
  });

  it("rule 6: never more than 3 cards, however large the pool; the same pool gives the same cards", async () => {
    const ids = [e1.id, e2.id, e3.id, e4.id, e5.id, marketer.id];
    const a = await previewFor(ids);
    const b = await previewFor(ids);
    expect(a.count).toBe(6);
    expect(a.samples).toHaveLength(3);
    expect(b.samples).toEqual(a.samples);
  });

  it("rule 5: availability flags pass through, and NOTHING identifying is anywhere in the payload", async () => {
    const p = await previewFor([e1.id, e2.id, e3.id, e4.id, e5.id, marketer.id]);
    const text = JSON.stringify(p);
    const forbidden = [
      "Fixture",
      "Person-",
      "example.com",
      "2348000000000",
      "Lagos",
      "Nigeria",
      "Employer-",
      "Ltd",
      "secret description",
      "Chief",
      "Staff Platform",
      "Senior Software",
      "Brand Strategist",
      ...fixtures.map((f) => f.id),
    ];
    for (const needle of forbidden) expect(text, `the preview payload leaks "${needle}"`).not.toContain(needle);
  });
});

/* ---------------------------------------------------------------------- *
 * Who may call what. The anon role needs no session, so this part runs anywhere; the `authenticated` half is in the RLS suite.
 * ---------------------------------------------------------------------- */
describe("the internal functions are not callable by anon", () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it.each([
    ["talent_directory_listed_ids", {}],
    ["talent_directory_listed_count", {}],
    ["talent_directory_preview_for", { p_ids: [] as string[] }],
    ["talent_directory_preview", {}],
    ["talent_directory_years_band", { p_years: 3 }],
    ["talent_directory_role_family", { p_title: "Engineer" }],
  ] as const)("%s refuses anon", async (fn, args) => {
    const { data, error } = await anon.rpc(fn as never, args as never);
    expect(error, `${fn} answered an anonymous caller`).not.toBeNull();
    expect(data ?? null).toBeNull();
  });
});
