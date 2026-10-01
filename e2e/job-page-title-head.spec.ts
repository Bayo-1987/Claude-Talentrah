import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { randomUUID } from "node:crypto";

/**
 * S12 (h) — the job page's <head>, on the BUILT app: the title has the new shape and og:title / twitter:title are the very
 * same string, the canonical is unchanged, and nothing else in the head moved (description keeps its
 * "<Role> at <Company> · <Place>. <snippet>" form, og:type stays article, og:url stays the page's own path).
 */
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin =
  SERVICE && SUPA_URL
    ? createClient<Database>(SUPA_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
if (process.env.CI && !admin) throw new Error("job-page-title-head spec cannot run in CI: missing service key or Supabase URL");

test("the job page title, og:title and twitter:title agree; canonical and the rest of the head are unchanged", async ({ page }) => {
  if (!admin) return;
  const tag = randomUUID().slice(0, 8);
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      title: `Head Probe Engineer ${tag}`,
      company_name: "Head Probe Co",
      location: "Nairobi, Kenya",
      work_type: "onsite",
      external_source: "e2e",
      external_url: `https://example.invalid/e2e/${tag}`,
      status: "open",
      description: `Fixture posting for the job-page head e2e (${tag}). It builds and maintains the services that move money across the continent.`,
      dedup_fingerprint: `e2e-head-${tag}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture: ${error?.message}`);
  try {
    await page.goto(`/jobs/${data.id}`);
    const head = await page.evaluate(() => {
      const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content ?? null;
      return {
        title: document.title,
        ogTitle: meta('meta[property="og:title"]'),
        twitterTitle: meta('meta[name="twitter:title"]'),
        ogType: meta('meta[property="og:type"]'),
        ogUrl: meta('meta[property="og:url"]'),
        description: meta('meta[name="description"]'),
        canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
      };
    });
    const want = `Head Probe Engineer ${tag} at Head Probe Co — Nairobi`;
    // 55 characters without the suffix, 67 with it, and the cap is 65: the suffix is the part that goes first
    expect(head.title).toBe(want);
    expect(head.ogTitle).toBe(head.title);
    expect(head.twitterTitle).toBe(head.title);
    expect(head.title.length).toBeLessThanOrEqual(65);
    expect(new URL(head.canonical!).pathname).toBe(`/jobs/${data.id}`);
    expect(new URL(head.ogUrl!, "http://x").pathname).toBe(`/jobs/${data.id}`);
    expect(head.ogType).toBe("article");
    expect(head.description).toMatch(new RegExp(`^Head Probe Engineer ${tag} at Head Probe Co · Nairobi, Kenya\\. `));
  } finally {
    await admin.from("job_postings").delete().eq("id", data.id);
  }
});
