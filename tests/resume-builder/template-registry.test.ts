/**
 * The template library's two load-bearing invariants.
 *
 * WHAT WAS WRONG BEFORE THIS. `resume_templates` had seven rows differing only
 * in name, category and price, and every resume rendered through the single
 * `ResumeDocument` component no matter which was chosen — the preview page did
 * not even SELECT `template_id`. Picking a template changed nothing you could
 * see, including for the two premium ones that cost 10 credits to unlock. The
 * gallery was, in effect, selling a label.
 *
 * These tests exist so that cannot come back quietly:
 *   1. every row in the LIVE catalog resolves to a registered component, so a
 *      template can't ship without a layout;
 *   2. the registry actually returns DIFFERENT components for different slugs,
 *      so "wired up" can't regress to "everything maps to the default".
 *
 * Test 1 hits the real database on purpose. The catalog is the thing that
 * drifts — a row added by a migration or by seed without a matching component
 * is exactly the failure mode, and a fixture list would just restate the
 * registry back to itself and pass forever.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  DEFAULT_TEMPLATE_SLUG,
  getTemplateAtsSafety,
  getTemplateComponent,
  registeredSlugs,
} from "@/components/resume-builder/templates";
import { PREVIEW_SAMPLE_RESUME } from "@/lib/resume-builder/preview-sample";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Template registry test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe("every catalog row has a slug and a component", () => {
  it("no template row is missing a slug", async () => {
    const { data, error } = await admin.from("resume_templates").select("id, name, slug");
    if (error) throw error;
    expect(data ?? [], "catalog is empty — run `npm run seed`").not.toHaveLength(0);

    const unslugged = (data ?? []).filter((t) => !t.slug?.trim());
    expect(
      unslugged.map((t) => t.name),
      "a template without a slug cannot be mapped to a layout at all",
    ).toEqual([]);
  });

  it("slugs are unique across the catalog", async () => {
    // 0042 adds a unique constraint; this asserts the data, so a constraint
    // dropped in a later migration surfaces here rather than as duplicate
    // gallery cards.
    const { data } = await admin.from("resume_templates").select("slug");
    const slugs = (data ?? []).map((t) => t.slug);
    expect(new Set(slugs).size, `duplicate slugs: ${slugs.join(", ")}`).toBe(slugs.length);
  });

  /**
   * FREE templates that knowingly have no distinct layout yet and render as
   * clean-professional. This list is a deliberate scope boundary, not an
   * excuse — PR2 shipped four new templates plus fixes for the two premium
   * ones that were already charging for the default layout, and left these
   * four as a named, tracked gap rather than a silent one.
   *
   * EMPTY AS OF TEMPLATE LIBRARY PR3. All four (`structured-admin`,
   * `product-tech`, `field-notes`, `ledger`) got a real `structure_schema` in
   * this PR — see `src/components/resume-builder/skeletons/catalog-configs.ts`
   * — so the list shrank to nothing, exactly as its own rule below requires.
   * Left in place (rather than deleted) so a FUTURE regression that quietly
   * unmaps one of them is caught the same way — by adding it back here with a
   * reason, not by the tests below silently tolerating it.
   *
   * Two rules, both enforced below:
   *   * it may only ever SHRINK — adding a slug here is how "we'll style it
   *     later" becomes permanent;
   *   * nothing PREMIUM may appear in it. A paid template rendering the free
   *     default is a product that takes money for nothing, and the separate
   *     premium assertion below has no exemption list at all.
   */
  const KNOWN_UNSTYLED_FREE_SLUGS: readonly string[] = [];

  it("every catalog slug resolves to a REGISTERED component, or is a known free exception", async () => {
    /*
     * The assertion that actually catches drift. `getTemplateComponent`
     * deliberately falls back rather than throwing, so calling it proves
     * nothing on its own — an unmapped slug returns the default and looks
     * fine. This checks membership in the registry instead.
     */
    const { data } = await admin.from("resume_templates").select("name, slug").order("name");
    const registered = new Set(registeredSlugs());

    const unmapped = (data ?? [])
      .filter((t) => !registered.has(t.slug))
      .filter((t) => !KNOWN_UNSTYLED_FREE_SLUGS.includes(t.slug as never))
      .map((t) => `${t.name} (${t.slug})`);

    expect(
      unmapped,
      `these catalog templates have no component and would silently render as ${DEFAULT_TEMPLATE_SLUG}. ` +
        `Either add a component, or add the slug to KNOWN_UNSTYLED_FREE_SLUGS with a reason — and only if it is free.`,
    ).toEqual([]);
  });

  it("the exception list only contains FREE templates, and only ones that still exist", async () => {
    const { data } = await admin
      .from("resume_templates")
      .select("name, slug, is_premium, unlock_cost_credits");
    const bySlug = new Map((data ?? []).map((t) => [t.slug, t]));

    const paidExceptions = KNOWN_UNSTYLED_FREE_SLUGS.filter((s) => bySlug.get(s)?.is_premium).map(
      (s) => `${bySlug.get(s)!.name} (${bySlug.get(s)!.unlock_cost_credits} credits)`,
    );
    expect(
      paidExceptions,
      "a PREMIUM template is being excused from having a layout — it would charge credits for the free default",
    ).toEqual([]);

    const stale = KNOWN_UNSTYLED_FREE_SLUGS.filter((s) => !bySlug.has(s));
    expect(stale, "exception list references slugs that are no longer in the catalog").toEqual([]);

    const nowRegistered = KNOWN_UNSTYLED_FREE_SLUGS.filter((s) => registeredSlugs().includes(s));
    expect(
      nowRegistered,
      "these now HAVE components — remove them from KNOWN_UNSTYLED_FREE_SLUGS so the list keeps shrinking",
    ).toEqual([]);
  });

  it("every premium template renders something distinct from the free default", async () => {
    /*
     * The money assertion. A premium template that renders identically to a
     * free one is a paid product that delivers nothing — which is exactly what
     * shipped before this milestone, for both premium templates in the
     * catalog.
     */
    const { data } = await admin
      .from("resume_templates")
      .select("name, slug, unlock_cost_credits")
      .eq("is_premium", true);

    const fallback = getTemplateComponent(DEFAULT_TEMPLATE_SLUG);
    const identical = (data ?? [])
      .filter((t) => getTemplateComponent(t.slug) === fallback)
      .map((t) => `${t.name} (${t.slug}, ${t.unlock_cost_credits} credits)`);

    expect(
      identical,
      "PAID FOR NOTHING: these premium templates render exactly like the free default",
    ).toEqual([]);
  });
});

describe("the registry maps slugs to distinct components", () => {
  it("returns a different component for each registered slug", () => {
    const seen = new Map<unknown, string>();
    for (const slug of registeredSlugs()) {
      const component = getTemplateComponent(slug);
      const already = seen.get(component);
      expect(
        already,
        `"${slug}" and "${already}" resolve to the same component — one of them has no distinct layout`,
      ).toBeUndefined();
      seen.set(component, slug);
    }
    expect(seen.size).toBe(registeredSlugs().length);
  });

  it("falls back to clean-professional for an unmapped or missing slug", () => {
    const fallback = getTemplateComponent(DEFAULT_TEMPLATE_SLUG);
    for (const slug of [null, undefined, "", "not-a-real-template"]) {
      expect(
        getTemplateComponent(slug),
        `${JSON.stringify(slug)} should render rather than crash the preview page`,
      ).toBe(fallback);
    }
  });

  it("clean-professional is still the original ResumeDocument", async () => {
    // Existing resumes must look exactly as they did before this milestone.
    // Anything else is a silent restyle of work users already finished.
    const { ResumeDocument } = await import("@/components/resume-builder/resume-document");
    expect(getTemplateComponent("clean-professional")).toBe(ResumeDocument);
  });
});

describe("the preview page renders the template a resume actually points at", () => {
  /**
   * The end-to-end shape of the bug this milestone fixes, asserted against the
   * real query rather than the registry in isolation.
   *
   * Before this, `resume-builder/preview/page.tsx` selected
   * `id, title, structured_content` — no `template_id` at all — and rendered
   * `ResumeDocument` unconditionally. So the assertion that matters is not
   * "the registry works" but "the page's own SELECT returns a slug, and that
   * slug picks a different component for a different template."
   */
  it("the preview query returns the joined slug, and it drives the component choice", async () => {
    const { data: templates } = await admin
      .from("resume_templates")
      .select("id, slug")
      .in("slug", ["clean-professional", "statute"]);
    const clean = templates?.find((t) => t.slug === "clean-professional");
    const statute = templates?.find((t) => t.slug === "statute");
    if (!clean || !statute) throw new Error("Expected both templates in the catalog.");

    const { data: owner, error: userErr } = await admin.auth.admin.createUser({
      email: `tmplpreview-${crypto.randomUUID()}@talentrah.test`,
      email_confirm: true,
    });
    if (userErr) throw userErr;

    try {
      const { data: resumes, error } = await admin
        .from("resumes")
        .insert([
          {
            user_id: owner.user!.id,
            is_base: false,
            title: "on statute",
            source: "builder",
            structured_content: {},
            template_id: statute.id,
          },
          {
            user_id: owner.user!.id,
            is_base: false,
            title: "on clean",
            source: "builder",
            structured_content: {},
            template_id: clean.id,
          },
        ])
        .select("id, template_id");
      if (error) throw error;

      // Exactly the select the preview page runs.
      const { data: rows, error: qErr } = await admin
        .from("resumes")
        .select("id, title, structured_content, template_id, resume_templates(slug)")
        .in(
          "id",
          resumes!.map((r) => r.id),
        );
      if (qErr) throw qErr;

      const onStatute = rows!.find((r) => r.title === "on statute")!;
      const onClean = rows!.find((r) => r.title === "on clean")!;

      expect(onStatute.resume_templates?.slug, "the join must return a slug").toBe("statute");
      expect(onClean.resume_templates?.slug).toBe("clean-professional");

      const statuteComponent = getTemplateComponent(onStatute.resume_templates?.slug);
      const cleanComponent = getTemplateComponent(onClean.resume_templates?.slug);

      expect(
        statuteComponent,
        "two resumes on different templates resolved to the SAME component — template choice is still cosmetic",
      ).not.toBe(cleanComponent);

      const { ResumeDocument } = await import("@/components/resume-builder/resume-document");
      expect(cleanComponent).toBe(ResumeDocument);
      expect(statuteComponent).not.toBe(ResumeDocument);
    } finally {
      await admin.auth.admin.deleteUser(owner.user!.id);
    }
  });

  it("a resume with no template still renders", async () => {
    // `resumes.template_id` is nullable and every uploaded/tailored resume has
    // it null — those must not crash the preview page.
    expect(getTemplateComponent(null)).toBe(getTemplateComponent(DEFAULT_TEMPLATE_SLUG));
  });
});

/**
 * Template library PR 2 of 3 — the layout-skeleton + style-token system.
 *
 * Three more things this milestone must not regress, on top of the two
 * PR1-era invariants above:
 *
 *   1. every LIVE catalog row renders something for a real resume, not just
 *      "resolves to a component" — a component that exists but throws on
 *      real content is exactly as broken as no component at all;
 *   2. every PREMIUM row's rendered HTML is different from the free
 *      default's — the identity check above (`getTemplateComponent(slug) !==
 *      fallback`) is necessary but not sufficient: two DIFFERENT component
 *      references could still coincidentally render identical markup for a
 *      given resume. This test renders both and diffs the actual strings;
 *   3. every row's `ats_safe` column agrees with what the application code
 *      believes about that slug (`getTemplateAtsSafety`,
 *      `TEMPLATE_ATS_SAFETY` in templates/index.tsx) — so a migration that
 *      sets the column and a later code change that reclassifies a slug
 *      can't quietly drift apart. The underlying "is this skeleton actually
 *      safe" claim is verified separately, against a real generated PDF, in
 *      `e2e/ats-safety.spec.ts`.
 *
 * SABOTAGE-PROOF, PERFORMED LIVE DURING THIS PR (not committed as a
 * permanent meta-test — see this repo's own `zz_temp_sabotage_*` /
 * `zz_revert_sabotage_*` migration pairs for the established convention this
 * follows): `REGISTRY["statute"]` was temporarily pointed at `ResumeDocument`
 * (the free default) and
 * `the registry maps slugs to distinct components > returns a different
 * component for each registered slug` (above, this file) was run in
 * isolation — it failed immediately with `"statute" and "clean-professional"
 * resolve to the same component`, then passed again once reverted. That is
 * the exact failure class the premium-distinctness test below exists to
 * catch, at the same layer (the component/HTML resolution), so the proof
 * transfers.
 */
describe("Template library PR 2 — every catalog row renders real content", () => {
  it("every LIVE catalog row renders a real resume without throwing, and shows its content", async () => {
    const { data, error } = await admin.from("resume_templates").select("slug, name");
    if (error) throw error;
    expect(data ?? [], "catalog is empty — run `npm run seed`").not.toHaveLength(0);

    const broken: string[] = [];
    for (const row of data ?? []) {
      try {
        const Component = getTemplateComponent(row.slug);
        const html = renderToStaticMarkup(createElement(Component, { resume: PREVIEW_SAMPLE_RESUME }));
        if (!html.includes(PREVIEW_SAMPLE_RESUME.contact.name!)) {
          broken.push(`${row.name} (${row.slug}): rendered but dropped the resume's own name`);
        }
      } catch (err) {
        broken.push(`${row.name} (${row.slug}): threw — ${(err as Error).message}`);
      }
    }
    expect(broken, "these catalog rows do not render a real resume").toEqual([]);
  });

  it("every PREMIUM row's rendered HTML actually differs from the free default's — not just a different component reference", async () => {
    const { data, error } = await admin
      .from("resume_templates")
      .select("name, slug, unlock_cost_credits")
      .eq("is_premium", true);
    if (error) throw error;

    const Fallback = getTemplateComponent(DEFAULT_TEMPLATE_SLUG);
    const fallbackHtml = renderToStaticMarkup(createElement(Fallback, { resume: PREVIEW_SAMPLE_RESUME }));

    const identical = (data ?? [])
      .map((t) => {
        const Component = getTemplateComponent(t.slug);
        const html = renderToStaticMarkup(createElement(Component, { resume: PREVIEW_SAMPLE_RESUME }));
        return { t, html };
      })
      .filter(({ html }) => html === fallbackHtml)
      .map(({ t }) => `${t.name} (${t.slug}, ${t.unlock_cost_credits} credits)`);

    expect(
      identical,
      "PAID FOR NOTHING: these premium templates render BYTE-IDENTICAL HTML to the free default for the same resume",
    ).toEqual([]);
  });

  it("every row's ats_safe column agrees with the application's own classification", async () => {
    const { data, error } = await admin.from("resume_templates").select("name, slug, ats_safe");
    if (error) throw error;

    const mismatched = (data ?? [])
      .filter((t) => t.ats_safe !== getTemplateAtsSafety(t.slug))
      .map(
        (t) =>
          `${t.name} (${t.slug}): DB says ats_safe=${t.ats_safe}, TEMPLATE_ATS_SAFETY says ${getTemplateAtsSafety(t.slug)}`,
      );

    expect(
      mismatched,
      "the ats_safe migration and TEMPLATE_ATS_SAFETY have drifted apart for these rows",
    ).toEqual([]);
  });

  it("clean-professional's DB structure_schema matches its source-of-truth config exactly", async () => {
    const { CLEAN_PROFESSIONAL_CONFIG } = await import("@/components/resume-builder/skeletons/configs");
    const { data, error } = await admin
      .from("resume_templates")
      .select("structure_schema")
      .eq("slug", "clean-professional")
      .single();
    if (error) throw error;

    expect(
      data.structure_schema,
      "structure_schema for clean-professional must match CLEAN_PROFESSIONAL_CONFIG " +
        "(skeletons/configs.ts) — this is the shape PR3's 54 new rows are expected to follow",
    ).toEqual(JSON.parse(JSON.stringify(CLEAN_PROFESSIONAL_CONFIG)));
  });
});

/**
 * Template library PR 3 of 3 — the 54-row library, plus real
 * `structure_schema` for the 4 formerly-fallback free slugs.
 *
 * The two PR2 tests above ("every LIVE catalog row renders...", "every
 * PREMIUM row's rendered HTML actually differs from the free default's...")
 * already generalize to all 65 rows with no change — they query the live
 * catalog and iterate whatever is actually in it. What they do NOT catch is
 * two NEW rows accidentally sharing one config: both would still differ from
 * the free default (passing the PR2 test above) while being identical to
 * EACH OTHER, which is exactly the bug a copy-paste between two of PR3's 54
 * new `catalog-configs.ts` entries could introduce silently. This test
 * closes that gap by diffing every row's rendered HTML against every other
 * row's, not just against the fallback.
 *
 * SABOTAGE-PROOF, PERFORMED LIVE DURING THIS PR. Temporarily pointed
 * `terminal`'s entry in `CATALOG_TEMPLATE_CONFIGS`
 * (skeletons/catalog-configs.ts) at `FIELD_NOTES_CONFIG` instead of its own
 * `TERMINAL_CONFIG` — collapsing two of the 54 new rows onto one config —
 * and ran this test in isolation: it failed immediately with
 * `"terminal" renders BYTE-IDENTICAL HTML to "field-notes"`, then passed
 * again once reverted. See the PR description for the full transcript.
 */
describe("Template library PR 3 — the 54-row library", () => {
  it("the catalog now has 65 rows (11 from PR1/PR2 + 54 new)", async () => {
    const { data, error } = await admin.from("resume_templates").select("id");
    if (error) throw error;
    expect(data ?? []).toHaveLength(65);
  });

  it("every row's rendered HTML is unique across the WHOLE catalog, not just distinct from the free default", async () => {
    const { data, error } = await admin.from("resume_templates").select("name, slug");
    if (error) throw error;
    expect(data ?? [], "catalog is empty — run `npm run seed`").not.toHaveLength(0);

    const htmlToSlug = new Map<string, string>();
    const collisions: string[] = [];
    for (const row of data ?? []) {
      const Component = getTemplateComponent(row.slug);
      const html = renderToStaticMarkup(createElement(Component, { resume: PREVIEW_SAMPLE_RESUME }));
      const already = htmlToSlug.get(html);
      if (already) {
        collisions.push(`"${row.slug}" renders BYTE-IDENTICAL HTML to "${already}"`);
      } else {
        htmlToSlug.set(html, row.slug);
      }
    }

    expect(
      collisions,
      "two catalog rows render identical HTML for the same resume — one of them has no distinct layout " +
        "(check for a copy-paste in skeletons/catalog-configs.ts)",
    ).toEqual([]);
  });

  it("every PR3-configured slug's DB structure_schema matches its source config in catalog-configs.ts exactly", async () => {
    const { CATALOG_TEMPLATE_CONFIGS } = await import(
      "@/components/resume-builder/skeletons/catalog-configs"
    );
    const slugs = Object.keys(CATALOG_TEMPLATE_CONFIGS);
    expect(slugs.length, "expected the 4 fixed PR2 slugs + 54 new PR3 slugs").toBe(58);

    const { data, error } = await admin
      .from("resume_templates")
      .select("slug, structure_schema")
      .in("slug", slugs);
    if (error) throw error;
    expect(data ?? []).toHaveLength(58);

    const mismatched = (data ?? [])
      .filter(
        (row) =>
          JSON.stringify(row.structure_schema) !==
          JSON.stringify(JSON.parse(JSON.stringify(CATALOG_TEMPLATE_CONFIGS[row.slug]))),
      )
      .map((row) => row.slug);

    expect(
      mismatched,
      "DB structure_schema has drifted from CATALOG_TEMPLATE_CONFIGS for these slugs",
    ).toEqual([]);
  });
});
