/**
 * No code that runs as the SIGNED-IN USER or the SIGNED-OUT VISITOR reads a column that 0232 withholds, or selects `*` / `organizations(*)` on one of the
 * four tables it narrows (organizations, scholarships, blog_posts, mentorship_reviews).
 *
 * Why a source scan: once 0232 is applied the API roles can no longer read those columns, so any such read fails 42501 and, on a statically rendered
 * page, fails the build or (where a loader swallows the error) empties the page. Service-role code reads everything and is not the subject. The scan
 * decides which client a chain belongs to by finding where the variable in front of `.from(` was made (`createServiceRoleClient()` is the service role;
 * anything else, including a client passed in as a parameter, is treated as the caller's and is held to the rule).
 *
 * The refusal rule is the same one tests/support/fake-grants-client.ts applies to the call sites at run time (tests/lib/identifier-column-call-sites.test.ts),
 * so what is scanned and what is simulated cannot drift apart. Pure source scan, no database: it runs everywhere.
 */
import { describe, expect, it } from "vitest";
import { WITHHELD } from "../support/fake-grants-client";
import { CONSTANTS, FILES, SCRIPTS, clientKind, problemsIn, stripComments } from "../support/withheld-column-scan";

describe("no caller-client read is refused by the 0232 grants", () => {
  it("scans the queries it is supposed to be scanning (the scan itself is not empty)", () => {
    const tables = Object.keys(WITHHELD);
    let narrowed = 0;
    let serviceRole = 0;
    let caller = 0;
    for (const { text: raw } of FILES) {
      const text = stripComments(raw);
      for (const m of text.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) {
        if (!tables.includes(m[1])) continue;
        narrowed++;
        if (clientKind(text, m.index!).kind === "service") serviceRole++;
        else caller++;
      }
    }
    expect(narrowed, "the scan found almost no reads of the four tables, so it proves nothing").toBeGreaterThan(45);
    expect(serviceRole, "no service-role chain was recognised, so the client detection is broken").toBeGreaterThan(30);
    expect(caller, "no caller-client chain was recognised, so the client detection is broken").toBeGreaterThanOrEqual(8);
    expect(CONSTANTS.get("PUBLIC_COLUMNS"), "named select lists are not being resolved").toMatch(/program_name/);
  });

  it("no .select() of a caller's client on organizations, scholarships, blog_posts or mentorship_reviews, or an embed of one, is refused", () => {
    expect(problemsIn(FILES), "name readable columns (src/lib/scholarships/columns.ts, src/lib/employer/organization-columns.ts) or read through the service role after the right check").toEqual([]);
  });

  it("every script that reads one of the four tables does so with the service-role key (so scripts/ is correctly outside the column rule)", () => {
    const tables = Object.keys(WITHHELD);
    const touching = SCRIPTS.filter((f) => tables.some((t) => new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]`).test(stripComments(f.text))));
    expect(touching.length, "no script reads the four tables, so this check proves nothing").toBeGreaterThanOrEqual(3);
    for (const f of touching) {
      expect(f.text, `${f.path} reads a narrowed table but does not use the service-role key`).toMatch(/SERVICE_ROLE_KEY|serviceKey|createServiceRoleClient/);
    }
  });

  it("the scan itself catches each shape it exists for (checked on strings, not on the repo)", () => {
    const one = (code: string) => problemsIn([{ path: "x.ts", text: `import { createClient } from "@/lib/supabase/server";\nconst supabase = await createClient();\n${code}` }]);
    expect(one('const r = await supabase.from("scholarships").select("*").eq("id", id);')).toHaveLength(1);
    expect(one('const r = await supabase.from("scholarships").select("*", { count: "exact" });')).toHaveLength(1);
    expect(one('const r = await supabase.from("scholarships").select("id, moderation_note");')).toHaveLength(1);
    expect(one('const r = await supabase.from("organization_members").select("role, organizations(*)");')).toHaveLength(1);
    expect(one('const r = await supabase.from("job_postings").select("id, organizations(id, created_by)");')).toHaveLength(1);
    expect(one('const r = await supabase.from("blog_posts").insert(row).select();')).toHaveLength(1);
    expect(one('const r = await supabase.from("scholarships").select("id").eq("moderated_by", me);')).toHaveLength(1);
    expect(one('const r = await supabase.from("scholarships").select("id").order("moderated_by");')).toHaveLength(1);
    expect(one('const L = "id, cac_number";\nconst r = await supabase.from("organizations").select(L);')).toHaveLength(1);
    // a list held in a variable we cannot resolve, on a narrowed table, is refused rather than guessed at
    expect(one("const r = await supabase.from(\"scholarships\").select(someList);")).toHaveLength(1);
    // and the shapes that are fine
    expect(one('const r = await supabase.from("scholarships").select("id, program_name").eq("id", id);')).toHaveLength(0);
    expect(one('const r = await supabase.from("organization_members").select("role, organizations(id, name, verified)");')).toHaveLength(0);
    expect(one('const r = await supabase.from("job_postings").select("*");')).toHaveLength(0);
    expect(one('const r = await supabase.from("mentorship_reviews").insert(row);')).toHaveLength(0);
    const service = `const admin = createServiceRoleClient();\nconst r = await admin.from("scholarships").select("*");`;
    expect(problemsIn([{ path: "x.ts", text: service }])).toHaveLength(0);
    const injected = "export async function f(client: Client) {\n  return client.from(\"scholarships\").select(\"*\");\n}";
    expect(problemsIn([{ path: "x.ts", text: injected }]), "a client passed in as a parameter is the caller's").toHaveLength(1);
    const typedService = "export async function f(admin: ReturnType<typeof createServiceRoleClient>) {\n  return admin.from(\"scholarships\").select(\"*\");\n}";
    expect(problemsIn([{ path: "x.ts", text: typedService }])).toHaveLength(0);
  });
});
