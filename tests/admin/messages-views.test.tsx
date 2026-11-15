import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminMessageRow } from "@/lib/notifications/contract";
import { ApprovePanel } from "@/components/admin/messages/approve-panel";
import { MessageDetailView, MessagesIndexView, closedReason, type MessageActions } from "@/components/admin/messages/message-views";
import { LimitsPanel } from "@/components/admin/messages/limits-panel";
import { ComposeForm } from "@/components/admin/messages/compose-form";
import { emptyOutcomeCounts, countOutcomes } from "@/components/admin/messages/outcome-counts";
import { QUIET_HOURS_SENTENCE, SWITCHED_OFF_NOTICE, pausedSentence } from "@/components/admin/messages/texts";

const noop = vi.fn(async () => ({ status: "idle" as const }));
const actions: MessageActions = { prepare: noop, testSend: noop, submit: noop, approve: noop, cancel: noop, send: noop, continueEmail: noop, resume: noop };
const ON = { sendPathOpen: true, promotionsOn: true, emailOn: true };
const LIMITS = { cap24h: 50, ceilingMonth: 2000, sentLast24h: 12, sentThisMonth: 340 };
const COUNTS = { inapp: 10, push: 4, email: 8, queuedEmail: 3 };

function message(over: Partial<AdminMessageRow> = {}): AdminMessageRow {
  return {
    id: "00000000-0000-4000-8000-000000000001", kind: "service_announcement", title: "A change to sign-in", body: "We are moving the sign-in page.", link_path: "/jobs",
    channels: ["inapp", "email"], segment_key: "everyone", segment_params: {}, consent_line: null, status: "draft", requires_approval: true, audience_count: 10,
    sent_count: 0, failed_count: 0, skipped_count: 0, kind_confirmed_by_approver: null, created_by: null, created_by_email: "creator.operator@example.test",
    approved_by: null, approved_by_email: null, sent_started_at: null, created_at: "2026-11-14T10:00:00Z", ...over,
  };
}
const detail = (m: AdminMessageRow, switches = ON, limits = LIMITS) =>
  renderToStaticMarkup(<MessageDetailView message={m} counts={COUNTS} outcomes={emptyOutcomeCounts()} limits={limits} switches={switches} events={[]} actions={actions} />);

describe("the approval screen", () => {
  it("renders the message kind as the screen's prominent label, and asks for the kind tick", () => {
    for (const [kind, label] of [["promotion", "Promotion"], ["service_announcement", "Service announcement"]] as const) {
      const html = renderToStaticMarkup(<ApprovePanel messageId="m1" kind={kind} action={noop} />);
      expect(html).toMatch(new RegExp(`<h2[^>]*data-testid="approval-kind"[^>]*>${label}</h2>`));
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('name="confirmKind"');
      expect(html).toContain(`name="kind" value="${kind}"`);
    }
  });

  it("the detail view shows the approval screen only while the message waits for approval", () => {
    expect(detail(message({ status: "submitted" }))).toContain('name="confirmKind"');
    for (const status of ["draft", "prepared", "approved", "sending", "sent"] as const) expect(detail(message({ status }))).not.toContain('name="confirmKind"');
  });
});

describe("plain words", () => {
  it("the page states that a push in quiet hours is suppressed and not retried, and that in-app and email still reach the person", () => {
    expect(QUIET_HOURS_SENTENCE).toMatch(/22:00 to 07:00/);
    expect(QUIET_HOURS_SENTENCE).toMatch(/suppressed/);
    expect(QUIET_HOURS_SENTENCE).toMatch(/not retried/);
    expect(QUIET_HOURS_SENTENCE).toMatch(/in the app and by email/);
    expect(QUIET_HOURS_SENTENCE).toMatch(/no urgent override/);
    const compose = renderToStaticMarkup(<ComposeForm action={noop} promotionsOn emailOn />);
    expect(compose).toContain(QUIET_HOURS_SENTENCE);
    expect(detail(message({ channels: ["push", "email"] }))).toContain(QUIET_HOURS_SENTENCE);
    expect(detail(message({ channels: ["inapp"] }))).not.toContain(QUIET_HOURS_SENTENCE);
  });

  it("says plainly when mass email is paused for the daily cap and when it is paused for the monthly ceiling", () => {
    expect(pausedSentence("paused_email_cap", LIMITS)).toContain("Mass email is paused: the 24-hour cap of 50 has been reached.");
    expect(pausedSentence("paused_email_ceiling", LIMITS)).toContain("Mass email is paused: this month's ceiling of 2000 has been reached.");
    expect(pausedSentence("sending", LIMITS)).toBeNull();
    expect(detail(message({ status: "paused_email_cap" }))).toContain("the 24-hour cap of 50 has been reached");
    expect(detail(message({ status: "paused_email_ceiling" }))).toContain("this month&#x27;s ceiling of 2000 has been reached");
  });

  it("shows the quiet-hours and cap skips apart from sent, once there are outcomes", () => {
    const outcomes = countOutcomes([
      { to_push: true, push_outcome: "sent", to_email: false, email_outcome: null },
      { to_push: true, push_outcome: "skipped_quiet_hours", to_email: false, email_outcome: null },
      { to_push: true, push_outcome: "skipped_cap", to_email: true, email_outcome: "sent" },
    ]);
    const html = renderToStaticMarkup(<MessageDetailView message={message({ status: "sent", channels: ["push", "email"] })} counts={COUNTS} outcomes={outcomes} limits={LIMITS} switches={ON} events={[]} actions={actions} />);
    expect(html).toContain("Sent: 1");
    expect(html).toContain("Skipped: quiet hours: 1");
    expect(html).toContain("Skipped: push cap: 1");
  });
});

describe("the switches are per case, and a switched-off page shows a notice, never an error", () => {
  it("admin_messaging off: no send path at all", () => {
    const html = renderToStaticMarkup(<MessagesIndexView switches={{ sendPathOpen: false, promotionsOn: false, emailOn: false }} messages={[]} limits={LIMITS} queued={0} canEditLimits setLimit={noop} resolveClaim={noop} staleClaims={[]} />);
    expect(html).toContain(SWITCHED_OFF_NOTICE);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    const d = detail(message({ status: "approved" }), { sendPathOpen: false, promotionsOn: false, emailOn: false });
    expect(d).toContain(SWITCHED_OFF_NOTICE);
    expect(d).not.toContain("<form");
    expect(d).not.toContain(">Send<");
  });

  it("admin_promotions off blocks promotions only; admin_email off blocks the email channel only", () => {
    const base = { sendPathOpen: true, promotionsOn: false, emailOn: true };
    expect(closedReason(base, { kind: "promotion", channels: ["inapp"] })).toMatch(/Promotions are switched off/);
    expect(closedReason(base, { kind: "service_announcement", channels: ["inapp", "email"] })).toBeNull();
    const noEmail = { sendPathOpen: true, promotionsOn: true, emailOn: false };
    expect(closedReason(noEmail, { kind: "service_announcement", channels: ["email"] })).toMatch(/Admin email is switched off/);
    expect(closedReason(noEmail, { kind: "service_announcement", channels: ["inapp"] })).toBeNull();
    expect(detail(message({ status: "approved" }), noEmail)).not.toContain(">Send<");
  });
});

describe("the limits panel", () => {
  const panel = (canEdit: boolean) => renderToStaticMarkup(<LimitsPanel limits={LIMITS} queued={7} canEdit={canEdit} setLimit={noop} />);
  it("shows the cap, the ceiling, what was sent and what is queued to everyone who can open the page", () => {
    const html = panel(false);
    for (const n of ["50", "2000", "12", "340", "7"]) expect(html).toContain(`>${n}<`);
  });
  it("is editable only for a Super Admin, and says that raising a limit does not resume a message", () => {
    expect(panel(false)).not.toContain("<input");
    expect(panel(false)).toContain("Only a Super Admin can change these limits.");
    expect((panel(true).match(/type="number"/g) ?? []).length).toBe(2);
    expect(panel(true)).toContain("does not resume a paused message");
  });
});

describe("the page shows counts only", () => {
  it("the outcome reader selects the outcome and channel columns and no identity", () => {
    const src = readFileSync(join(__dirname, "../../src/app/admin/(protected)/messages/outcomes.ts"), "utf8");
    expect(src).toContain('.select("push_outcome, email_outcome, to_push, to_email")');
    expect(src).not.toMatch(/user_id|\.email\b|select\("\*"\)/);
  });
  it("no messages component or page reads a recipient's identity", () => {
    for (const f of ["components/admin/messages/message-views.tsx", "components/admin/messages/limits-panel.tsx", "components/admin/messages/stale-claims-panel.tsx", "app/admin/(protected)/messages/page.tsx", "app/admin/(protected)/messages/[id]/page.tsx"]) {
      const src = readFileSync(join(__dirname, "../../src", f), "utf8");
      expect(src, f).not.toMatch(/\buser_id\b|unsubscribe_token|profiles/);
    }
  });
  it("the detail view carries numbers and the message, and no address", () => {
    expect(detail(message({ status: "sent" }))).not.toMatch(/zq7\.|@example\.test"?>[^<]*recipient/);
  });
});
