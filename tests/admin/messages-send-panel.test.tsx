import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminMessageRow } from "@/lib/notifications/contract";
import { MessageDetailView, type MessageActions } from "@/components/admin/messages/message-views";
import { emptyOutcomeCounts } from "@/components/admin/messages/outcome-counts";

const noop = vi.fn(async () => ({ status: "idle" as const }));
const actions: MessageActions = { prepare: noop, testSend: noop, submit: noop, approve: noop, cancel: noop, send: noop, continueEmail: noop, resume: noop };
const ON = { sendPathOpen: true, promotionsOn: true, emailOn: true };
const LIMITS = { cap24h: 50, ceilingMonth: 2000, sentLast24h: 0, sentThisMonth: 0 };
const COUNTS = { inapp: 0, push: 0, email: 0, queuedEmail: 0 };

function message(over: Partial<AdminMessageRow> = {}): AdminMessageRow {
  return {
    id: "00000000-0000-4000-8000-000000000001", kind: "service_announcement", title: "A change to sign-in", body: "We are moving the sign-in page.", link_path: "/jobs",
    channels: ["inapp"], segment_key: "everyone", segment_params: {}, consent_line: null, status: "prepared", requires_approval: false, audience_count: 60,
    sent_count: 0, failed_count: 0, skipped_count: 0, kind_confirmed_by_approver: null, created_by: null, created_by_email: "creator.operator@example.test",
    approved_by: null, approved_by_email: null, sent_started_at: null, created_at: "2026-11-22T10:00:00Z", ...over,
  };
}
const detail = (m: AdminMessageRow) => renderToStaticMarkup(<MessageDetailView message={m} counts={COUNTS} outcomes={emptyOutcomeCounts()} limits={LIMITS} switches={ON} events={[]} actions={actions} />);
const confirmInput = (html: string) => /<input[^>]*name="confirmSend"[^>]*>/.exec(html)?.[0] ?? null;

describe("the Send panel of a message with no second approver", () => {
  it("says how many people it will go to, from the frozen audience count", () => {
    expect(detail(message({ audience_count: 60 }))).toMatch(/This will go to 60 people\./);
    expect(detail(message({ audience_count: 2 }))).toMatch(/This will go to 2 people\./);
    expect(detail(message({ audience_count: 1 }))).toMatch(/This will go to 1 person\./);
  });
  it("over 50 people it asks for SEND to be typed; the input is labelled and has a 44px target", () => {
    const html = detail(message({ audience_count: 51 }));
    const input = confirmInput(html);
    expect(input, "no confirmSend input").not.toBeNull();
    expect(input).toMatch(/autoComplete="off"|autocomplete="off"/);
    expect(html).toMatch(/Type SEND to confirm/);
    expect(input).toMatch(/min-h-\[44px\]|h-11/);
  });
  it("at 50 or fewer there is the sentence and no input", () => {
    for (const n of [50, 1, 0]) expect(confirmInput(detail(message({ audience_count: n })))).toBeNull();
  });
  it("is shown only while the message can be sent (prepared and not needing approval)", () => {
    for (const status of ["draft", "sending", "sent", "cancelled"] as const) expect(detail(message({ status, audience_count: 60 }))).not.toMatch(/This will go to/);
  });
});

describe("a message that goes through the two-person route looks exactly as it did", () => {
  it("an approved message with approval required shows the Send button and neither the sentence nor the input", () => {
    const html = detail(message({ status: "approved", requires_approval: true, audience_count: 60 }));
    expect(html).toContain(">Send<");
    expect(html).not.toMatch(/This will go to/);
    expect(confirmInput(html)).toBeNull();
  });
});
