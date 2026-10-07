/**
 * HWR-2: "Go to your dashboard" goes to /dashboard, and /dashboard sends an employer (a member of an organisation) to /employer and everyone else to /jobs. The decision is this
 * one function, so the seeker and employer cases are pinned without a database; the real redirects are in e2e/masthead-dashboard-button.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { dashboardDestination } from "@/lib/auth/dashboard-destination";

describe("dashboardDestination", () => {
  it("an organisation member goes to /employer", () => {
    expect(dashboardDestination({ organizationId: "00000000-0000-0000-0000-000000000001" })).toBe("/employer");
  });
  it("a seeker (no membership) goes to /jobs", () => {
    expect(dashboardDestination(null)).toBe("/jobs");
  });
  it("a failed membership lookup falls back to /jobs, never to a page that needs an organisation", () => {
    expect(dashboardDestination(undefined)).toBe("/jobs");
  });
});
