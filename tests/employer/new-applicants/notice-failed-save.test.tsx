/**
 * The email setting on Jobs Posted when the save FAILS: the select goes back to the previous value, "Saved" is not shown, and the person reads a plain sentence, never the database's own text.
 *
 * The component's real code runs (its click handler, its transition, its state); React's two hooks it uses are replaced by a tiny recorder so it can be driven without a DOM. The Server Action is replaced
 * for the component tests, and the REAL action runs against a faked database for the last test, which proves the raw database message never leaves the server.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  action: vi.fn(),
  db: { error: null as null | { message: string }, data: [{ user_id: "u1" }] as unknown[] | null },
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = next; }];
  },
  useTransition: () => [false, (fn: () => unknown) => fn()],
}));
vi.mock("@/lib/employer/new-applicant-notice-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/employer/new-applicant-notice-actions")>()),
  setNewApplicantNoticeAction: (mode: string) => h.action(mode),
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: h.db.data, error: h.db.error }) }) }) }),
  }),
}));
vi.mock("@/lib/employer/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/employer/membership")>()),
  requireEmployer: async () => ({ organization: { id: "org1" } }),
}));

import { NewApplicantNoticeSelect, NewApplicantNoticeView } from "@/components/employer/new-applicant-notice-select";
import { NOTICE_SAVED, NOTICE_SAVE_FAILED } from "@/lib/employer/new-applicants/notice-mode";

type ViewProps = React.ComponentProps<typeof NewApplicantNoticeView>;

/** Render the component once with the recorder's current state; returns the props it hands its view and that view's HTML. */
function render(initialMode: "instant" | "digest" | "off") {
  h.cursor = 0;
  const element = NewApplicantNoticeSelect({ initialMode }) as React.ReactElement<ViewProps>;
  return { props: element.props, html: renderToStaticMarkup(element) };
}

beforeEach(() => {
  h.slots = [];
  h.cursor = 0;
  h.action.mockReset();
  h.db = { error: null, data: [{ user_id: "u1" }] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a failed save", () => {
  async function chooseDigestAndFail() {
    h.action.mockResolvedValue({ ok: false, error: NOTICE_SAVE_FAILED });
    const first = render("instant");
    const done = first.props.onChange({ target: { value: "digest" } } as unknown as React.ChangeEvent<HTMLSelectElement>) as unknown;
    await Promise.resolve(done);
    await new Promise((r) => setTimeout(r, 0));
    return render("instant");
  }

  it("puts the select back on the previous value", async () => {
    const after = await chooseDigestAndFail();
    expect(h.action).toHaveBeenCalledWith("digest");
    expect(after.props.mode).toBe("instant");
    expect(after.html).toMatch(/<option value="instant" selected/);
  });
  it("does not show Saved", async () => {
    const after = await chooseDigestAndFail();
    expect(after.props.saved).toBe(false);
    expect(after.html).not.toContain(NOTICE_SAVED);
  });
  it("shows the plain sentence as an alert", async () => {
    const after = await chooseDigestAndFail();
    expect(after.props.error).toBe(NOTICE_SAVE_FAILED);
    expect(after.html).toMatch(/role="alert"[^>]*>Couldn&#x27;t save\. Try again\.</);
  });
});

describe("a save that works, for contrast", () => {
  it("keeps the new value and shows Saved", async () => {
    h.action.mockResolvedValue({ ok: true, mode: "digest" });
    const first = render("instant");
    await first.props.onChange({ target: { value: "digest" } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    await new Promise((r) => setTimeout(r, 0));
    const after = render("instant");
    expect(after.props.mode).toBe("digest");
    expect(after.html).toMatch(/role="status"[^>]*>Saved</);
    expect(after.html).not.toContain('role="alert"');
  });
});

describe("the real action never lets the database's text out", () => {
  it("returns exactly the plain sentence, and logs the database message on the server", async () => {
    h.db = { error: { message: 'duplicate key value violates unique constraint "email_preferences_pkey"' }, data: null };
    const { setNewApplicantNoticeAction } = await vi.importActual<typeof import("@/lib/employer/new-applicant-notice-actions")>("@/lib/employer/new-applicant-notice-actions");
    const out = await setNewApplicantNoticeAction("digest");
    expect(out).toEqual({ ok: false, error: NOTICE_SAVE_FAILED });
    expect(JSON.stringify(out)).not.toMatch(/duplicate key|constraint|email_preferences/);
    expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(" ")).toContain("duplicate key");
  });
});
