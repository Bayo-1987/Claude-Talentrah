/**
 * send-496 / S11 — how a saved entry that is NOT an open posting renders on the feed's Saved tab.
 *
 * Founder call: a closed role shows "This role has closed", is NEVER offered Apply or Auto-Apply, and can be removed.
 * A manual tracker entry renders from its snapshot and points at the tracker, where it is managed.
 * Reached through loadModule so this compiles before the component exists.
 */
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";

vi.mock("@/lib/applications/actions", () => ({ toggleSaveAction: async () => {} }));

type Entry = { applicationId: string; jobPostingId: string | null; kind: "closed" | "manual"; title: string; companyName: string; location?: string; url?: string };

async function render(entry: Entry): Promise<string> {
  const mod = await loadModule<{ SavedEntryCard?: ComponentType<{ entry: Entry }> }>("@/components/jobs/saved-entry-card");
  expect(mod.SavedEntryCard, "SavedEntryCard must be exported from src/components/jobs/saved-entry-card.tsx").toBeTypeOf("function");
  return renderToStaticMarkup(createElement(mod.SavedEntryCard as ComponentType<{ entry: Entry }>, { entry }));
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const CLOSED: Entry = { applicationId: "a1", jobPostingId: "p1", kind: "closed", title: "Backend Engineer", companyName: "Paystack", location: "Lagos, Nigeria", url: "https://example.test/job/1" };
const MANUAL: Entry = { applicationId: "a2", jobPostingId: null, kind: "manual", title: "Designer", companyName: "Acme" };

describe("a closed saved role", () => {
  it("names the job and says 'This role has closed'", async () => {
    const t = text(await render(CLOSED));
    expect(t).toContain("Backend Engineer");
    expect(t).toContain("Paystack");
    expect(t).toContain("Lagos, Nigeria");
    expect(t).toContain("This role has closed");
  });

  it("is never offered Apply, Auto-Apply, Ask Farah or a match score", async () => {
    const html = await render(CLOSED);
    const t = text(html);
    expect(t).not.toMatch(/\bApply\b/);
    expect(t).not.toMatch(/Auto-?Apply/i);
    expect(t).not.toMatch(/Ask Farah/i);
    expect(html).not.toMatch(/%\s*match|match score/i);
    // Nothing that submits an application either.
    expect(html).not.toMatch(/applyInApp|applyWith|markApplied/i);
  });

  it("offers Remove, as a real form button bound to the posting", async () => {
    const html = await render(CLOSED);
    expect(html).toMatch(/<form[^>]*>[\s\S]*<button[^>]*type="submit"[^>]*>[^<]*Remove[^<]*<\/button>[\s\S]*<\/form>/);
  });

  it("links to the original listing safely when it has one", async () => {
    const html = await render(CLOSED);
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.test\/job\/1"[^>]*rel="noopener noreferrer"[^>]*>|<a [^>]*rel="noopener noreferrer"[^>]*href="https:\/\/example\.test\/job\/1"[^>]*>/);
  });

  it("omits the listing link when there is no url", async () => {
    const html = await render({ ...CLOSED, url: undefined });
    expect(html).not.toMatch(/href="https?:/);
  });
});

describe("a manual tracker entry on the Saved tab", () => {
  it("renders from its snapshot and says it is the user's own entry, not a closed role", async () => {
    const t = text(await render(MANUAL));
    expect(t).toContain("Designer");
    expect(t).toContain("Acme");
    expect(t).toContain("Added by you");
    expect(t).not.toContain("This role has closed");
  });

  it("points at the tracker, where it is managed, and offers no Apply", async () => {
    const html = await render(MANUAL);
    expect(html).toMatch(/href="\/tracker\?stage=saved"/);
    expect(text(html)).not.toMatch(/\bApply\b|Auto-?Apply/i);
  });
});
