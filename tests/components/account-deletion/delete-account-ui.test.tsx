/**
 * ACCT-1 PR 1 — what the person sees: the Settings section, the confirm page, and the "restore it, or keep the deletion?" prompt.
 *
 * Rendered with react-dom/server so the real components are read, not a description of them. What is pinned is the owner's wording decisions:
 * the typed phrase, the credits-forfeited sentence at the confirm step, the reason shown when deleting is blocked (never a bare disabled
 * button), the list of postings that will be closed, and a prompt that asks rather than restoring silently.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/account-deletion/actions", () => ({
  requestAccountDeletionAction: vi.fn(),
  confirmAccountDeletionAction: vi.fn(),
  restoreAccountAction: vi.fn(),
  keepDeletionAction: vi.fn(),
}));

import { DeleteAccountSection } from "@/components/account-deletion/delete-account-section";
import { ConfirmDeletionPanel } from "@/components/account-deletion/confirm-deletion-panel";
import { ScheduledDeletionPrompt } from "@/components/account-deletion/scheduled-deletion-prompt";

const NONE = { mentorship_sessions: [], mentor_payouts: [], organisations_with_other_members: [], postings_to_close: [], campaigns_to_pause: 0, blocked: false };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("DeleteAccountSection", () => {
  it("asks for the typed phrase and says what the confirmation email is for", () => {
    const html = renderToStaticMarkup(<DeleteAccountSection creditsBalance={0} blockers={NONE} />);
    expect(text(html)).toMatch(/delete my account/i);
    expect(html).toContain('name="confirmation"');
    expect(text(html)).toMatch(/email/i);
    expect(text(html)).toMatch(/30 days/);
  });

  it("states the credits that are forfeited, with the number, in the confirm step", () => {
    const html = text(renderToStaticMarkup(<DeleteAccountSection creditsBalance={37} blockers={NONE} />));
    expect(html).toMatch(/37 credits/);
    expect(html).toMatch(/forfeit/i);
  });

  it("uses the singular for one credit and says nothing about credits for none", () => {
    expect(text(renderToStaticMarkup(<DeleteAccountSection creditsBalance={1} blockers={NONE} />))).toMatch(/1 credit\b(?!s)/);
    expect(text(renderToStaticMarkup(<DeleteAccountSection creditsBalance={0} blockers={NONE} />))).not.toMatch(/forfeit/i);
  });

  it("lists, by title, the postings that will be closed", () => {
    const blockers = { ...NONE, postings_to_close: [{ id: "p1", title: "Staff Engineer", organization: "Acme" }, { id: "p2", title: "Designer", organization: "Acme" }] };
    const html = text(renderToStaticMarkup(<DeleteAccountSection creditsBalance={0} blockers={blockers} />));
    expect(html).toContain("Staff Engineer");
    expect(html).toContain("Designer");
    expect(html).toMatch(/closed/i);
  });

  it("when blocked by a mentoring session, says why and offers no form", () => {
    const blockers = { ...NONE, blocked: true, mentorship_sessions: [{ id: "s1", role: "mentor" as const, session_type: "mock_interview", scheduled_start: "2026-10-09T10:00:00Z", status: "confirmed" }] };
    const markup = renderToStaticMarkup(<DeleteAccountSection creditsBalance={5} blockers={blockers} />);
    expect(text(markup)).toMatch(/can.t delete your account yet/i);
    expect(text(markup)).toMatch(/mentoring session/i);
    expect(text(markup)).toMatch(/9 Oct 2026/);
    expect(markup).not.toContain('name="confirmation"');
  });

  it("when blocked by a pending payout, says so", () => {
    const blockers = { ...NONE, blocked: true, mentor_payouts: [{ id: "x", amount_ngn: 5000, status: "pending" }] };
    expect(text(renderToStaticMarkup(<DeleteAccountSection creditsBalance={0} blockers={blockers} />))).toMatch(/payout/i);
  });

  it("when blocked by an organisation with other members, says why (no hand-over flow yet, so it points at support)", () => {
    const blockers = { ...NONE, blocked: true, organisations_with_other_members: [{ id: "o1", name: "Acme Ltd" }] };
    const html = text(renderToStaticMarkup(<DeleteAccountSection creditsBalance={0} blockers={blockers} />));
    expect(html).toContain("Acme Ltd");
    expect(html).toMatch(/ownership/i);
  });
});

describe("ConfirmDeletionPanel", () => {
  it("carries the token in a hidden field and asks for one explicit click", () => {
    const token = "cd".repeat(32);
    const markup = renderToStaticMarkup(<ConfirmDeletionPanel token={token} creditsBalance={12} postingsToClose={[]} />);
    expect(markup).toContain(`name="token"`);
    expect(markup).toContain(`value="${token}"`);
    expect(text(markup)).toMatch(/12 credits/);
    expect(text(markup)).toMatch(/signed out everywhere/i);
  });

  it("repeats the postings that will be closed", () => {
    const markup = renderToStaticMarkup(<ConfirmDeletionPanel token={"ab".repeat(32)} creditsBalance={0} postingsToClose={[{ id: "p1", title: "Staff Engineer", organization: "Acme" }]} />);
    expect(text(markup)).toContain("Staff Engineer");
  });
});

describe("ScheduledDeletionPrompt", () => {
  it("asks 'restore it, or keep the deletion?' with the date, and offers both as buttons", () => {
    const markup = renderToStaticMarkup(<ScheduledDeletionPrompt hardDeleteAfter="2026-11-01T12:00:00Z" creditsForfeited={12} error={null} />);
    const t = text(markup);
    expect(t).toMatch(/scheduled for deletion on 1 Nov 2026/);
    expect(t).toMatch(/Restore it, or keep the deletion\?/);
    expect(markup).toMatch(/Restore my account/);
    expect(markup).toMatch(/Keep the deletion/);
  });

  it("explains what restoring does and does not bring back", () => {
    const t = text(renderToStaticMarkup(<ScheduledDeletionPrompt hardDeleteAfter="2026-11-01T12:00:00Z" creditsForfeited={0} error={null} />));
    expect(t).toMatch(/Auto-Apply/);
    expect(t).toMatch(/stays off|remain off|turned off/i);
  });

  it("shows a closed window honestly", () => {
    const t = text(renderToStaticMarkup(<ScheduledDeletionPrompt hardDeleteAfter="2026-11-01T12:00:00Z" creditsForfeited={0} error="window_closed" />));
    expect(t).toMatch(/can no longer be restored|window has closed/i);
  });
});
