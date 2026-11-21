/**
 * U6 / NOTIF-UNSUB-PREF-GATE-1: /unsubscribe understands `pref=announcements` and `pref=promotions`, the two kinds of mass e-mail the admin messages send (spec 02 section 3). Each link turns off ONLY its own
 * kind through the 0265 stream function (the RPC names of the four existing kinds, the GET, and the token are not touched; preferences-unsubscribe-today.test.tsx pins those).
 * Same method as that file: no hand-written module factory, the page called as a function. (UNSUB-GET-SCANNER-1: the GET now only confirms; each case below moves its RPC assertion to the confirm action.)
 */
import { NOTIFICATION_RPCS } from "@/lib/notifications/contract-db";
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
import { COPY } from "@/app/unsubscribe/copy";
import { CONFIRMATION_COPY } from "@/app/unsubscribe/resubscribe-button";
import { parsePreference, type UnsubscribablePreference } from "@/app/unsubscribe/preference";

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
const open = async (query: { token?: string; pref?: string }) => (await UnsubscribePage({ searchParams: Promise.resolve(query) })) as ReactNode;

describe("pref=announcements and pref=promotions turn off only their own kind", () => {
  it.each([
    ["announcements", "announcement"],
    ["promotions", "offers and promotions"],
  ])("pref=%s: the GET calls nothing; the confirm action calls the stream function for that stream only, and the page says which", async (pref, phrase) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([]);
    expect(findProps(tree, "ConfirmUnsubscribe")).toMatchObject({ token: "tok", preference: pref });
    expect(await confirmUnsubscribeAction("tok", parsePreference(pref))).toBe("done");
    expect(calls).toEqual([{ name: NOTIFICATION_RPCS.emailUnsubscribeStream, args: { p_token: "tok", p_stream: pref, p_subscribed: false } }]);
    const copy = COPY[pref as "announcements" | "promotions"].unsubscribed;
    expect(copy.heading).toContain("You're unsubscribed.");
    expect(copy.body.toLowerCase()).toContain(phrase);
    expect(copy.body).not.toContain("weekly job-match email");
  });

  it("the two pages do not say the same thing (a wrong-kind mix-up would show)", async () => {
    const a = findProps(await open({ token: "tok", pref: "announcements" }), "ConfirmUnsubscribe");
    const p = findProps(await open({ token: "tok", pref: "promotions" }), "ConfirmUnsubscribe");
    expect(a?.preference).not.toBe(p?.preference);
    expect(COPY.announcements.unsubscribed.body).not.toBe(COPY.promotions.unsubscribed.body);
    expect(COPY.announcements.confirm.heading).not.toBe(COPY.promotions.confirm.heading);
  });

  it("a token nothing matches claims nothing for either kind", async () => {
    result = { data: [{ matched: false }], error: null };
    for (const pref of ["announcements", "promotions"] as const) {
      expect(await confirmUnsubscribeAction("stale", pref)).toBe("unmatched");
    }
    expect(calls).toHaveLength(2);
  });
});

describe("the undo restores the same kind, and only that kind", () => {
  it.each(["announcements", "promotions"] as const)("resubscribeAction(token, %s) -> the stream function(%s, true)", async (pref) => {
    expect(await resubscribeAction("tok", pref)).toBe(true);
    expect(calls).toEqual([{ name: NOTIFICATION_RPCS.emailUnsubscribeStream, args: { p_token: "tok", p_stream: pref, p_subscribed: true } }]);
  });
  it("every kind has its own words for the undo, and the two new ones name their kind", () => {
    const kinds: UnsubscribablePreference[] = ["job_match_digest", "proactive_match_alert", "scholarship_deadline_alert", "win_back_email", "announcements", "promotions"];
    for (const k of kinds) expect(CONFIRMATION_COPY[k].length).toBeGreaterThan(20);
    expect(CONFIRMATION_COPY.announcements.toLowerCase()).toContain("announcement");
    expect(CONFIRMATION_COPY.promotions.toLowerCase()).toContain("promotion");
    expect(new Set(kinds.map((k) => CONFIRMATION_COPY[k])).size).toBe(kinds.length);
  });
});

describe("an unknown or missing pref still means the weekly digest, exactly as before", () => {
  it.each([[undefined], ["bogus"], [""], ["Announcements"], ["PROMOTIONS"], ["announcements "], ["announcement"]])("parsePreference(%j) is the digest", (raw) => {
    expect(parsePreference(raw)).toBe("job_match_digest");
  });
  it.each([["bogus"], ["Announcements"], ["announcement"]])("the page for pref=%j still means the digest: its confirm action calls email_unsubscribe, its GET calls nothing", async (pref) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([]);
    expect(findProps(tree, "ConfirmUnsubscribe")).toMatchObject({ token: "tok", preference: "job_match_digest" });
    await confirmUnsubscribeAction("tok", parsePreference(pref));
    expect(calls).toEqual([{ name: "email_unsubscribe", args: { p_token: "tok", p_subscribed: false } }]);
  });
  it("the two new values parse to themselves, and the four old ones are unchanged", () => {
    expect(parsePreference("announcements")).toBe("announcements");
    expect(parsePreference("promotions")).toBe("promotions");
    expect(parsePreference("proactive_match_alert")).toBe("proactive_match_alert");
    expect(parsePreference("scholarship_deadline_alert")).toBe("scholarship_deadline_alert");
    expect(parsePreference("win_back_email")).toBe("win_back_email");
    expect(parsePreference("job_match_digest")).toBe("job_match_digest");
  });
});
