/**
 * CHARACTERISATION of /unsubscribe as it is TODAY (written first, green on unchanged code; NOTIF-UNSUB-PREF-GATE-1).
 *
 * The page is public, acts on GET, needs no session and is live with every flag OFF, so its "flags-off proof" is this file: for every link that exists today, the same RPC with the same arguments, the same
 * words, the same undo. The ONE thing U6 changes is what `pref=announcements` and `pref=promotions` do (they fall through to the weekly digest today); that pair is pinned separately below and replaced by its
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
import { resubscribeAction } from "@/app/unsubscribe/actions";
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

describe("today: a link with no pref, or an unknown pref, unsubscribes the weekly digest", () => {
  it.each([[undefined], ["bogus"], [""], ["Announcements-ish"]])("pref=%j calls email_unsubscribe with p_subscribed false and says so", async (pref) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([{ name: "email_unsubscribe", args: { p_token: "tok", p_subscribed: false } }]);
    expect(words(tree)).toContain("You're unsubscribed.");
    expect(words(tree)).toContain("weekly job-match email");
    expect(findProps(tree, "ResubscribeButton")).toMatchObject({ token: "tok", preference: "job_match_digest" });
  });
});

describe("today: the three named kinds each switch off their own column through their own function", () => {
  it.each([
    ["proactive_match_alert", "proactive_match_alert_set_preference", "exceptional match"],
    ["scholarship_deadline_alert", "scholarship_deadline_alert_set_preference", "saved scholarship's deadline"],
    ["win_back_email", "win_back_email_set_preference", "here's what you missed"],
  ])("pref=%s -> %s(p_enabled false)", async (pref, rpc, phrase) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([{ name: rpc, args: { p_token: "tok", p_enabled: false } }]);
    expect(words(tree)).toContain("You're unsubscribed.");
    expect(words(tree)).toContain(phrase);
    expect(findProps(tree, "ResubscribeButton")).toMatchObject({ token: "tok", preference: pref });
  });
});

describe("today: a link that does not work claims nothing", () => {
  it("no token: no call at all, and the 'didn't work' words", async () => {
    const tree = await open({ pref: "win_back_email" });
    expect(calls).toEqual([]);
    expect(words(tree)).toContain("That link didn't work.");
    expect(findProps(tree, "ResubscribeButton")).toBeNull();
  });
  it("a token nothing matches: the call is made, the 'didn't work' words, no undo button", async () => {
    result = { data: [{ matched: false }], error: null };
    const tree = await open({ token: "stale" });
    expect(calls).toHaveLength(1);
    expect(words(tree)).toContain("That link didn't work.");
    expect(findProps(tree, "ResubscribeButton")).toBeNull();
  });
  it("an RPC error: logged, 'didn't work', no undo button", async () => {
    result = { data: null, error: { message: "boom" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await open({ token: "tok" });
    expect(words(tree)).toContain("That link didn't work.");
    expect(findProps(tree, "ResubscribeButton")).toBeNull();
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
