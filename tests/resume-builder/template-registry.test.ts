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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  DEFAULT_TEMPLATE_SLUG,
  getTemplateComponent,
  registeredSlugs,
} from "@/components/resume-builder/templates";

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
   * excuse: the milestone shipped four new templates plus fixes for the two
   * premium ones that were already charging for the default layout.
   *
   * Two rules, both enforced below:
   *   * it may only ever SHRINK — adding a slug here is how "we'll style it
   *     later" becomes permanent;
   *   * nothing PREMIUM may appear in it. A paid template rendering the free
   *     default is a product that takes money for nothing, and the separate
   *     premium assertion below has no exemption list at all.
   */
  const KNOWN_UNSTYLED_FREE_SLUGS = [
    "structured-admin",
    "product-tech",
    "field-notes",
    "ledger",
  ] as const;

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
