/**
 * The four pages Paystack sends a buyer back to (credits and Passes, mentor booking, ad-wallet top-up, Talent Directory subscription) when the payment is NOT finished yet
 * (fulfillPayment answers "processing"): each says plainly that it is still processing, that nothing has been added yet and that they should not pay again; none of them says
 * "Something didn't go through", none redirects to a success page, and none tells a buyer who may have been charged that they have not been (the failure copy of the top-up page does).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ result: "processing" as string, redirected: null as string | null }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { state.redirected = to; throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), requireUser: async () => ({ user: { id: "u1" }, profile: { id: "u1" } }) }));
vi.mock("@/lib/employer/membership", () => ({ requireEmployer: async () => ({ userId: "u1", organization: { id: "org-1" } }) }));
vi.mock("@/lib/billing/fulfill", () => ({ fulfillPayment: async () => ({ status: state.result }) }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const props = { searchParams: Promise.resolve({ reference: "ref_123" }) };

const PAGES: Array<[string, () => Promise<{ default: (p: typeof props) => Promise<React.ReactElement> }>, string]> = [
  ["credits and Passes", () => import("@/app/(app)/billing/callback/page") as never, "/billing"],
  ["mentor booking", () => import("@/app/(app)/mentorship/book/callback/page") as never, "/mentorship"],
  ["ad-wallet top-up", () => import("@/app/employer/campaigns/topup-callback/page") as never, "/employer/campaigns"],
  ["Talent Directory subscription", () => import("@/app/employer/talent-directory/callback/page") as never, "/employer/talent-directory"],
];

beforeEach(() => {
  state.result = "processing";
  state.redirected = null;
});

describe.each(PAGES)("%s callback, payment not finished", (_name, load, back) => {
  it("says it is still processing, that nothing was added yet and not to pay again, and links back", async () => {
    const { default: Page } = await load();
    const out = text(renderToStaticMarkup(await Page(props)));
    expect(out).toMatch(/still processing/i);
    expect(out).toMatch(/nothing has been added yet|nothing was added yet|not been added yet/i);
    expect(out).toContain("If you paid, it will appear here shortly: please do not pay again.");
    expect(out).toContain("If you did not complete the payment, you can start again.");
    expect(out).toContain("support");
    const html = renderToStaticMarkup(await Page(props));
    expect(html).toContain(`href="${back}`);
    expect(text(html)).toContain("Start again from");
  });
  it("does not call it a failure, does not redirect to a success page and does not say the buyer was not charged", async () => {
    const { default: Page } = await load();
    const out = text(renderToStaticMarkup(await Page(props)));
    expect(out).not.toMatch(/didn't go through|payment issue|couldn't confirm|have not been charged/i);
    expect(state.redirected).toBeNull();
  });
  it("a real failure still reads as a failure (the other states are unchanged)", async () => {
    state.result = "failed";
    const { default: Page } = await load();
    const out = text(renderToStaticMarkup(await Page(props)));
    expect(out).not.toMatch(/still processing/i);
    expect(out).toMatch(/didn't go through|couldn't confirm|not been charged|haven't been charged|nothing was added/i);
  });
});
