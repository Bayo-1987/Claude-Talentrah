import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { TrackerCard, type TrackerEntry } from "@/components/tracker/tracker-card";

const BASE: TrackerEntry = {
  id: "app-1",
  stage: "interviewing",
  appliedAt: "2026-10-01T09:00:00Z",
  notes: null,
  updatedAt: null,
  companyName: "Zimcrest",
  title: "Growth Marketer",
  location: "Lagos",
  url: null,
  isManual: false,
  resumeId: null,
  coverLetterId: null,
  resumeSnapshotTitle: null,
  coverLetterSnapshotTitle: null,
  history: [],
  firstViewedAt: null,
};

describe("the Job Tracker card's interview line", () => {
  it("shows 'Interview scheduled, <date>' as a link to the invitation page when a booking exists", () => {
    const html = renderToStaticMarkup(<TrackerCard entry={{ ...BASE, interview: { startsAt: "2026-10-26T09:00:00Z", offerId: "offer-1" } }} />);
    expect(html).toContain("Interview scheduled, ");
    expect(html).toContain("26 Oct");
    expect(html).toContain('href="/interviews/offer-1"');
  });

  it("shows nothing when there is no booking, and the rest of the card reads exactly as before", () => {
    const without = renderToStaticMarkup(<TrackerCard entry={BASE} />);
    const withNull = renderToStaticMarkup(<TrackerCard entry={{ ...BASE, interview: null }} />);
    expect(without).not.toContain("Interview scheduled");
    expect(withNull).toBe(without);
    expect(without).toContain("Growth Marketer");
    expect(without).toContain("Applied");
  });

  it("a job seeker with no applications on screen has no lookup at all: the answer is an empty map, so no card gets a line and nothing errors", async () => {
    const { loadBookedInterviewsFor } = await import("@/lib/interviews/read");
    const none = await loadBookedInterviewsFor("00000000-0000-0000-0000-000000000000", []);
    expect(none.size).toBe(0);
  });
});
