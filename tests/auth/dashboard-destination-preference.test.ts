/**
 * The remembered side at /dashboard. The membership check stays the only thing that can send someone to /employer; the preference only chooses between the two homes of a MEMBER.
 * (The original three cases stay in tests/auth/dashboard-destination.test.ts, untouched.)
 */
import { describe, expect, it } from "vitest";
import { dashboardDestination } from "@/lib/auth/dashboard-destination";

const MEMBER = { organizationId: "00000000-0000-0000-0000-000000000001" };

describe("dashboardDestination with a remembered side", () => {
  it("a member with no preference goes to /employer (today's behaviour)", () => {
    expect(dashboardDestination(MEMBER)).toBe("/employer");
    expect(dashboardDestination(MEMBER, null)).toBe("/employer");
    expect(dashboardDestination(MEMBER, undefined)).toBe("/employer");
  });

  it("a member who last chose employer goes to /employer", () => {
    expect(dashboardDestination(MEMBER, "employer")).toBe("/employer");
  });

  it("a member who last chose seeker goes to /jobs", () => {
    expect(dashboardDestination(MEMBER, "seeker")).toBe("/jobs");
  });

  it("a NON-member goes to /jobs whatever the preference says: a forged employer value grants nothing", () => {
    expect(dashboardDestination(null, "employer")).toBe("/jobs");
    expect(dashboardDestination(undefined, "employer")).toBe("/jobs");
    expect(dashboardDestination(null, "seeker")).toBe("/jobs");
    expect(dashboardDestination(null, null)).toBe("/jobs");
  });
});
