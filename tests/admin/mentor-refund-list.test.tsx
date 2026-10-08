/** /admin/ops "Mark refunded": the form reports its result (error as an alert, success as a status) instead of throwing into the error boundary. Static render + source wiring (no @testing-library here). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/admin/ops/refund-actions", () => ({ markMentorPaymentRefundedAction: async () => ({ status: "idle" }) }));
import { MentorRefundList } from "@/components/admin/mentor-refund-list";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("MentorRefundList", () => {
  it("renders one Mark refunded form per row, carrying the session id in the body, with no message before anything was pressed", () => {
    const html = renderToStaticMarkup(
      <MentorRefundList rows={[{ sessionId: "s-1", amountNgn: 5000, markedAt: "2026-10-01T10:00:00Z", sessionStart: "2026-10-02T10:00:00Z", reference: "ref_1" }]} />,
    );
    expect(html).toContain('name="sessionId"');
    expect(html).toContain('value="s-1"');
    expect(html).toContain("Mark refunded");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
  it("shows the action's result: an error as an alert, a success as a status, from one state for the whole list", () => {
    const src = read("src/components/admin/mentor-refund-list.tsx");
    expect(src).toContain("useActionState(markMentorPaymentRefundedAction");
    expect(src).toContain('state.status === "error" ? "alert" : "status"');
  });
  it("the page uses the list and no longer binds a throwing action straight to a form", () => {
    const page = read("src/app/admin/(protected)/ops/page.tsx");
    expect(page).toContain("<MentorRefundList rows={refunds} />");
    expect(page).not.toContain("markMentorPaymentRefundedAction");
  });
});
