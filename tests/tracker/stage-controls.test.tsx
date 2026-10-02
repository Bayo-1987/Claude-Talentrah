/**
 * send-494 / S14 + X2 — the tracker's two stage controls, from one list.
 *
 *  - The "Add a job" form's Stage select kept its own array of lowercase strings, styled with CSS `capitalize`,
 *    and had no Hired. The filter bar and the cards (and the database enum) have Hired.
 *  - The per-card stage <select> had no accessible name: a screen reader announced "combobox, Applied" for every
 *    card, with nothing saying which job it changes.
 *
 * Both now render from TRACKER_STAGES (src/lib/tracker/stages.ts). Modules or props that do not exist yet are
 * reached through loadModule / a cast so this file compiles in the tests-first commit and fails on assertions.
 */
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TRACKER_STAGES } from "@/lib/tracker/stages";
import { TrackerCard, type TrackerEntry } from "@/components/tracker/tracker-card";
import { StageSelect } from "@/components/tracker/stage-select";
import { ManualEntryForm } from "@/components/tracker/manual-entry-form";
import { loadModule } from "../support/load-module";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/applications/tracker-actions", () => ({ updateStageAction: async () => {}, addManualEntryAction: async () => {} }));

const SELECT = StageSelect as unknown as ComponentType<Record<string, unknown>>;

const entry = (companyName: string, title: string): TrackerEntry => ({
  id: "22222222-2222-2222-2222-222222222222",
  stage: "applied",
  appliedAt: "2026-09-01T10:00:00.000Z",
  notes: null,
  updatedAt: null,
  companyName,
  title,
  location: null,
  url: null,
  isManual: false,
  resumeId: null,
  coverLetterId: null,
  resumeSnapshotTitle: null,
  coverLetterSnapshotTitle: null,
  history: [],
  firstViewedAt: null,
});

/** The <select> tag (opening tag only) with the given name attribute, or "". */
const selectTag = (html: string, name: string) => html.match(new RegExp(`<select\\b[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const optionsOf = (html: string) =>
  [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].filter((m) => m[1] !== "").map((m) => ({ key: m[1], label: m[2] }));

describe("isTrackerStage — the one validity check", () => {
  it("accepts exactly the keys of TRACKER_STAGES and nothing else", async () => {
    const { isTrackerStage } = await loadModule<{ isTrackerStage?: (v: unknown) => boolean }>("@/lib/tracker/stages");
    expect(isTrackerStage, "isTrackerStage must be exported from stages.ts").toBeTypeOf("function");
    for (const s of TRACKER_STAGES) expect(isTrackerStage!(s.key), s.key).toBe(true);
    for (const bad of ["bogus", "HIRED", "Hired", "", " hired", "all", null, undefined, 5, {}]) expect(isTrackerStage!(bad), String(bad)).toBe(false);
  });
});

describe("the per-card stage select has an accessible name", () => {
  it("StageSelect is named for the job and the company", () => {
    const html = renderToStaticMarkup(createElement(SELECT, { applicationId: "a", stage: "applied", jobTitle: "Backend Engineer", companyName: "Paystack" }));
    expect(selectTag(html, "stage")).toContain('aria-label="Stage for Backend Engineer at Paystack"');
  });

  it("each TrackerCard names ITS OWN job (not one hard-coded name for all)", () => {
    const a = renderToStaticMarkup(<TrackerCard entry={entry("Paystack", "Backend Engineer")} />);
    const b = renderToStaticMarkup(<TrackerCard entry={entry("Moniepoint", "Illustrator")} />);
    expect(selectTag(a, "stage")).toContain('aria-label="Stage for Backend Engineer at Paystack"');
    expect(selectTag(b, "stage")).toContain('aria-label="Stage for Illustrator at Moniepoint"');
  });

  it("escapes the job and company into the label instead of breaking out of the attribute", () => {
    const html = renderToStaticMarkup(<TrackerCard entry={entry('Acme "Labs"', "R&D <Lead>")} />);
    const tag = selectTag(html, "stage");
    expect(tag).toContain("aria-label=");
    expect(tag).not.toContain('"Labs"');
    expect(tag).not.toContain("<Lead>");
  });
});

describe("the Add-a-job form's Stage select", () => {
  const html = renderToStaticMarkup(<ManualEntryForm />);

  it("lists every tracker stage with its real label, Hired included, in the tracker's order", () => {
    expect(optionsOf(selectTag(html, "stage") ? html.slice(html.indexOf(selectTag(html, "stage"))) : html)).toEqual(
      TRACKER_STAGES.map((s) => ({ key: s.key, label: s.label })),
    );
  });

  it("does not rely on CSS to capitalise: the labels are already capitalised, and the select carries no `capitalize` class", () => {
    expect(selectTag(html, "stage")).not.toContain("capitalize");
    for (const { label } of optionsOf(html.slice(html.indexOf(selectTag(html, "stage"))))) expect(label[0]).toBe(label[0].toUpperCase());
  });

  it("starts on Saved", () => {
    expect(html).toMatch(/<option value="saved"[^>]*selected/);
  });
});
