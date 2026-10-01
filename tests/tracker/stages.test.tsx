/**
 * send-484 — TRACKER_STAGES: one list of the tracker's stages, extracted from two private copies.
 *
 * `StageFilterBar` kept its own STAGES array (with an "All" entry in front) and `TrackerCard` its own
 * STAGE_LABEL record, and the new signed-out /tracker landing page needs the same list a third time.
 * The extraction must change NOTHING a signed-in user sees, so this file has two halves:
 *
 *  1. CHARACTERISATION — what the two components render today. These pass on the code as it stood
 *     before the extraction and must pass identically after it; that is the proof the extraction
 *     preserved behaviour, rather than a claim that it did.
 *  2. THE EXTRACTION ITSELF — the new module exists, holds the stages in this order, and agrees with
 *     the database enum. Red until the module is added.
 *
 * `StageSelect` (the per-card dropdown) carries a THIRD private copy. It is deliberately not touched
 * here; the drift test below pins it equal to the shared list so the copies cannot diverge silently.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StageFilterBar } from "@/components/tracker/stage-filter-bar";
import { TrackerCard, type TrackerEntry } from "@/components/tracker/tracker-card";
import { StageSelect } from "@/components/tracker/stage-select";
import { Constants } from "@/lib/supabase/types";
import { loadModule } from "../support/load-module";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/applications/tracker-actions", () => ({ updateStageAction: async () => {} }));

/** The stages exactly as both components listed them before the extraction, in this order. */
const EXPECTED_STAGES = [
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
];

interface StagesModule {
  TRACKER_STAGES: ReadonlyArray<{ key: string; label: string }>;
}

function entry(history: TrackerEntry["history"]): TrackerEntry {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    stage: "applied",
    appliedAt: "2026-09-01T10:00:00.000Z",
    notes: null,
    updatedAt: null,
    companyName: "Paystack",
    title: "Backend Engineer",
    location: null,
    url: null,
    isManual: false,
    resumeId: null,
    coverLetterId: null,
    resumeSnapshotTitle: null,
    coverLetterSnapshotTitle: null,
    history,
    firstViewedAt: null,
  };
}

describe("characterisation — StageFilterBar renders the same stages as before", () => {
  const html = renderToStaticMarkup(<StageFilterBar stage="all" sort="newest" />);
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));

  it("shows All first, then every stage in the tracker's order, each linking to its own filter", () => {
    const filters = links.filter((l) => l.label !== "Sort: Newest first");
    expect(filters.map((l) => l.label)).toEqual(["All", ...EXPECTED_STAGES.map((s) => s.label)]);
    expect(filters[0].href).toBe("/tracker?sort=newest");
    for (const s of EXPECTED_STAGES) {
      expect(filters.find((l) => l.label === s.label)?.href, s.label).toBe(`/tracker?stage=${s.key}&amp;sort=newest`);
    }
  });

  it("is not vacuous: a different sort changes every href", () => {
    const other = renderToStaticMarkup(<StageFilterBar stage="all" sort="oldest" />);
    expect(other).toContain("/tracker?stage=saved&amp;sort=oldest");
    // The only remaining "newest" is the Sort toggle's own target, which flips to it.
    expect(other.match(/sort=newest/g)?.length).toBe(1);
  });
});

describe("characterisation — TrackerCard labels every stage in its history line as before", () => {
  const history = EXPECTED_STAGES.map((s, i) => ({ stage: s.key, changedAt: `2026-09-0${i + 1}T10:00:00.000Z` }));
  const html = renderToStaticMarkup(<TrackerCard entry={entry(history)} />);
  const line = html.match(/<p class="text-\[12px\] italic text-ink-soft">([^<]+)<\/p>/)?.[1] ?? "";

  it("prints the stage labels in history order", () => {
    expect(line, "no history line rendered").not.toBe("");
    const labels = line.split(" → ").map((part) => part.replace(/ \(.*$/, ""));
    expect(labels).toEqual(EXPECTED_STAGES.map((s) => s.label));
  });

  it("falls back to the raw key for a stage it has no label for (a row written by a newer enum)", () => {
    const odd = renderToStaticMarkup(<TrackerCard entry={entry([{ stage: "legacy_stage", changedAt: "2026-09-01T10:00:00.000Z" }, { stage: "applied", changedAt: "2026-09-02T10:00:00.000Z" }])} />);
    expect(odd).toContain("legacy_stage (");
    expect(odd).toContain("Applied (");
  });
});

describe("the extraction — TRACKER_STAGES", () => {
  it("is exported from src/lib/tracker/stages.ts with the stages in the tracker's order", async () => {
    const { TRACKER_STAGES } = await loadModule<StagesModule>("@/lib/tracker/stages");
    expect(TRACKER_STAGES.map((s) => ({ key: s.key, label: s.label }))).toEqual(EXPECTED_STAGES);
  });

  it("covers exactly the database's application_stage enum — no stage missing, none invented", async () => {
    const { TRACKER_STAGES } = await loadModule<StagesModule>("@/lib/tracker/stages");
    expect([...TRACKER_STAGES.map((s) => s.key)].sort()).toEqual([...Constants.public.Enums.application_stage].sort());
  });

  it("does not include the filter bar's 'All', which is a filter and not a stage", async () => {
    const { TRACKER_STAGES } = await loadModule<StagesModule>("@/lib/tracker/stages");
    expect(TRACKER_STAGES.map((s) => s.key)).not.toContain("all");
  });

  it("agrees with the third private copy in StageSelect, which this change does not touch (drift guard)", async () => {
    const { TRACKER_STAGES } = await loadModule<StagesModule>("@/lib/tracker/stages");
    const select = renderToStaticMarkup(<StageSelect applicationId="a" stage="applied" jobTitle="t" />);
    const options = [...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => ({ key: m[1], label: m[2] }));
    expect(options, "no <option> elements rendered").not.toEqual([]);
    expect(options).toEqual(TRACKER_STAGES.map((s) => ({ key: s.key, label: s.label })));
  });
});
