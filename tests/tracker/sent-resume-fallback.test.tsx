/**
 * The tracker still answers "what did I send?" after the resume is deleted.
 *
 * A snapshot column nobody reads is not a fix — it is a schema change that
 * makes the migration look careful while the product still loses the answer.
 * So this asserts the READER and the RENDER, not the column:
 *
 *   - parseResumeSnapshot turns what 0094's function writes into something
 *     usable, and survives a row that has been hand-edited into nonsense
 *     (0094 deliberately leaves `applications` owner-writable — see its
 *     header);
 *   - TrackerCard falls back to it when the FK is null, prefers the live
 *     resume when it is not, and says which one the user is looking at.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackerCard, type TrackerEntry } from "@/components/tracker/tracker-card";
import { parseResumeSnapshot } from "@/lib/applications/resume-snapshot";
import { EMPTY_RESUME } from "@/lib/resume/types";

const APP_ID = "22222222-2222-2222-2222-222222222222";
const LIVE_RESUME_ID = "33333333-3333-3333-3333-333333333333";

function entry(overrides: Partial<TrackerEntry> = {}): TrackerEntry {
  return {
    id: APP_ID,
    stage: "applied",
    appliedAt: "2026-09-01T10:00:00.000Z",
    notes: null,
    updatedAt: "2026-09-01T10:00:00.000Z",
    companyName: "Paystack",
    title: "Backend Engineer",
    location: "Lagos",
    url: null,
    isManual: false,
    resumeId: null,
    coverLetterId: null,
    resumeSnapshotTitle: null,
    coverLetterSnapshotTitle: null,
    history: [],
    ...overrides,
  };
}

describe("parseResumeSnapshot", () => {
  const written = {
    resumeId: LIVE_RESUME_ID,
    title: "Clean Professional — Sep 2",
    structuredContent: { ...EMPTY_RESUME, summary: "Ten years of Postgres." },
    capturedAt: "2026-09-04T09:00:00+00:00",
  };

  it("reads back exactly what the function writes", () => {
    const parsed = parseResumeSnapshot(written);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Clean Professional — Sep 2");
    expect(parsed!.content.summary).toBe("Ten years of Postgres.");
    expect(parsed!.resumeId).toBe(LIVE_RESUME_ID);
  });

  it("treats an absent or unusable snapshot as no snapshot, never as a crash", () => {
    for (const bad of [null, undefined, "not an object", 42, [], {}, { title: "  " }]) {
      expect(parseResumeSnapshot(bad), `parsed ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("keeps a snapshot whose content is broken but whose title survives", () => {
    // Partial recovery beats none: the card can still name the document.
    const parsed = parseResumeSnapshot({ title: "Tailored — Backend Engineer", structuredContent: 7 });
    expect(parsed?.title).toBe("Tailored — Backend Engineer");
    expect(parsed?.content.experience).toEqual([]);
  });
});

describe("TrackerCard", () => {
  it("links to the editor while the resume is still live", () => {
    const html = renderToStaticMarkup(<TrackerCard entry={entry({ resumeId: LIVE_RESUME_ID })} />);
    expect(html).toContain(`/resume-builder/edit?resumeId=${LIVE_RESUME_ID}`);
    expect(html).toContain("Resume used");
    expect(html).not.toContain("/sent?doc=");
  });

  it("falls back to the snapshot once the resume is gone, and says so", () => {
    /*
     * THE TEST THAT CATCHES THE HALF-FIX. With `ON DELETE SET NULL` and no
     * fallback the card renders nothing here at all — the delete "works" and
     * the application quietly stops saying what was sent, which is worse than
     * today's hard refusal. Asserted with a broken build first: dropping the
     * fallback branch from TrackerCard failed this on the missing link.
     */
    const html = renderToStaticMarkup(
      renderEntry({ resumeSnapshotTitle: "Clean Professional — Sep 2" }),
    );
    expect(html).toContain(`/tracker/${APP_ID}/sent?doc=resume`);
    // The label must not pretend the resume is still there.
    expect(html).toContain("deleted");
    expect(html).not.toContain("/resume-builder/edit?resumeId=");
  });

  it("does the same for a cover letter, independently", () => {
    const html = renderToStaticMarkup(
      renderEntry({ coverLetterSnapshotTitle: "Cover letter — Backend Engineer" }),
    );
    expect(html).toContain(`/tracker/${APP_ID}/sent?doc=cover-letter`);
    expect(html).not.toContain("doc=resume");
  });

  it("shows nothing at all when there is neither a resume nor a snapshot", () => {
    // Most rows: an external hand-off or a manual entry records no resume, and
    // must not sprout a dead link.
    const html = renderToStaticMarkup(<TrackerCard entry={entry()} />);
    expect(html).not.toContain("Resume used");
    expect(html).not.toContain("/sent?doc=");
  });
});

function renderEntry(overrides: Partial<TrackerEntry>) {
  return <TrackerCard entry={entry(overrides)} />;
}
