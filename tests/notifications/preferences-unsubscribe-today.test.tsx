/**
 * CHARACTERISATION of /unsubscribe (written first, green on unchanged code; NOTIF-UNSUB-PREF-GATE-1). UNSUB-GET-SCANNER-1 changed ONE thing: a GET no longer unsubscribes. The link lands on a confirm page and
 * changes nothing; the unsubscribe is the confirm action (the same RPC, the same arguments, the same words). The page is public, needs no session and is live with every flag OFF, so its "flags-off proof" is
 * this file: for every link that exists today, the same RPC with the same arguments, the same words, the same undo. The ONE thing U6 changes is what `pref=announcements` and `pref=promotions` do (they fall through to the weekly digest today); that pair is pinned separately below and replaced by its
 * successor when the change is made, with the old assertion shown failing first.
 *
 * No hand-written module factory (TEST-MOCK-1): the service-role module is replaced by a factory that spreads the real module and overrides one export. The page is called as a function and the returned
 * element tree is read; function components inside it are not run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let result: { data: Array<{ matched: boolean }> | null; error: { message: string } | null } = { data: [{ matched: true }], error: null };

vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return result;
    },
  }),
}));

import UnsubscribePage from "@/app/unsubscribe/page";
import { confirmUnsubscribeAction, resubscribeAction } from "@/app/unsubscribe/actions";
import { COPY, NOT_WORKING_COPY } from "@/app/unsubscribe/copy";
import { parsePreference } from "@/app/unsubscribe/preference";

beforeEach(() => {
  calls.length = 0;
  result = { data: [{ matched: true }], error: null };
});

type El = { type: unknown; props: { children?: ReactNode; [key: string]: unknown } };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n;
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return isEl(node) ? textOf(node.props.children) : "";
}
function findProps(node: ReactNode, wanted: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findProps(n, wanted);
      if (hit) return hit;
    }
    return null;
  }
  if (!isEl(node)) return null;
  if (typeof node.type === "function" && (node.type as { name?: string }).name === wanted) return node.props;
  return findProps(node.props.children, wanted);
}
async function open(query: { token?: string; pref?: string }) {
  return (await UnsubscribePage({ searchParams: Promise.resolve(query) })) as ReactNode;
}
const words = (tree: ReactNode) => textOf(tree).replace(/\s+/g, " ");

describe("a link with no pref, or an unknown pref, unsubscribes the weekly digest (on the confirm action, never on the GET)", () => {
  it.each([[undefined], ["bogus"], [""], ["Announcements-ish"]])("pref=%j: the GET calls nothing; the confirm action calls email_unsubscribe with p_subscribed false and the page says so", async (pref) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([]);
    expect(findProps(tree, "ConfirmUnsubscribe")).toMatchObject({ token: "tok", preference: "job_match_digest" });
    expect(await confirmUnsubscribeAction("tok", parsePreference(pref))).toBe("done");
    expect(calls).toEqual([{ name: "email_unsubscribe", args: { p_token: "tok", p_subscribed: false } }]);
    expect(COPY.job_match_digest.unsubscribed.heading).toContain("You're unsubscribed.");
    expect(COPY.job_match_digest.unsubscribed.body).toContain("weekly job-match email");
  });
});

describe("the three named kinds each switch off their own column through their own function (on the confirm action)", () => {
  it.each([
    ["proactive_match_alert", "proactive_match_alert_set_preference", "exceptional match"],
    ["scholarship_deadline_alert", "scholarship_deadline_alert_set_preference", "saved scholarship's deadline"],
    ["win_back_email", "win_back_email_set_preference", "here's what you missed"],
  ])("pref=%s -> %s(p_enabled false)", async (pref, rpc, phrase) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([]);
    expect(findProps(tree, "ConfirmUnsubscribe")).toMatchObject({ token: "tok", preference: pref });
    expect(await confirmUnsubscribeAction("tok", parsePreference(pref))).toBe("done");
    expect(calls).toEqual([{ name: rpc, args: { p_token: "tok", p_enabled: false } }]);
    const copy = COPY[parsePreference(pref)].unsubscribed;
    expect(copy.heading).toContain("You're unsubscribed.");
    expect(copy.body).toContain(phrase);
  });
});

describe("a link that does not work claims nothing", () => {
  it("no token: no call at all, and the 'didn't work' words, no confirm button", async () => {
    const tree = await open({ pref: "win_back_email" });
    expect(calls).toEqual([]);
    expect(words(tree)).toContain("That link didn't work.");
    expect(findProps(tree, "ConfirmUnsubscribe")).toBeNull();
    expect(findProps(tree, "ResubscribeButton")).toBeNull();
  });
  it("a token nothing matches: the confirm action makes the call and answers 'unmatched'; the words are the 'didn't work' words", async () => {
    result = { data: [{ matched: false }], error: null };
    expect(await confirmUnsubscribeAction("stale", "job_match_digest")).toBe("unmatched");
    expect(calls).toHaveLength(1);
    expect(NOT_WORKING_COPY.heading).toBe("That link didn't work.");
  });
  it("an RPC error: logged, the confirm action answers 'failed' (the 'didn't work' words)", async () => {
    result = { data: null, error: { message: "boom" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await confirmUnsubscribeAction("tok", "job_match_digest")).toBe("failed");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("today: the undo uses the same token and the matching function with true", () => {
  it.each([
    [undefined, "email_unsubscribe", { p_token: "tok", p_subscribed: true }],
    ["job_match_digest", "email_unsubscribe", { p_token: "tok", p_subscribed: true }],
    ["proactive_match_alert", "proactive_match_alert_set_preference", { p_token: "tok", p_enabled: true }],
    ["scholarship_deadline_alert", "scholarship_deadline_alert_set_preference", { p_token: "tok", p_enabled: true }],
    ["win_back_email", "win_back_email_set_preference", { p_token: "tok", p_enabled: true }],
  ])("resubscribeAction(token, %j) -> %s", async (pref, rpc, args) => {
    const ok = await resubscribeAction("tok", parsePreference(pref ?? undefined));
    expect(ok).toBe(true);
    expect(calls).toEqual([{ name: rpc, args }]);
  });
  it("no token: false, no call", async () => {
    expect(await resubscribeAction("", "job_match_digest")).toBe(false);
    expect(calls).toEqual([]);
  });
});
