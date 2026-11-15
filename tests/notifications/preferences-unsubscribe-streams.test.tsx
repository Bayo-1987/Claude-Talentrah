/**
 * U6 / NOTIF-UNSUB-PREF-GATE-1: /unsubscribe understands `pref=announcements` and `pref=promotions`, the two kinds of mass e-mail the admin messages send (spec 02 section 3). Each link turns off ONLY its own
 * kind through the 0265 stream function (the RPC names of the four existing kinds, the GET, and the token are not touched; preferences-unsubscribe-today.test.tsx pins those).
 * Same method as that file: no hand-written module factory, the page called as a function.
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
import { resubscribeAction } from "@/app/unsubscribe/actions";
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
const words = (tree: ReactNode) => textOf(tree).replace(/\s+/g, " ");

describe("pref=announcements and pref=promotions turn off only their own kind", () => {
  it.each([
    ["announcements", "announcement"],
    ["promotions", "offers and promotions"],
  ])("pref=%s calls the stream function for that stream only, and the page says which", async (pref, phrase) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([{ name: NOTIFICATION_RPCS.emailUnsubscribeStream, args: { p_token: "tok", p_stream: pref, p_subscribed: false } }]);
    expect(words(tree)).toContain("You're unsubscribed.");
    expect(words(tree).toLowerCase()).toContain(phrase);
    expect(words(tree)).not.toContain("weekly job-match email");
    expect(findProps(tree, "ResubscribeButton")).toMatchObject({ token: "tok", preference: pref });
  });

  it("the two pages do not say the same thing (a wrong-kind mix-up would show)", async () => {
    const a = words(await open({ token: "tok", pref: "announcements" }));
    const p = words(await open({ token: "tok", pref: "promotions" }));
    expect(a).not.toBe(p);
  });

  it("a token nothing matches claims nothing for either kind", async () => {
    result = { data: [{ matched: false }], error: null };
    for (const pref of ["announcements", "promotions"]) {
      const tree = await open({ token: "stale", pref });
      expect(words(tree)).toContain("That link didn't work.");
      expect(findProps(tree, "ResubscribeButton")).toBeNull();
    }
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
  it.each([["bogus"], ["Announcements"], ["announcement"]])("the page for pref=%j still calls email_unsubscribe (the digest)", async (pref) => {
    await open({ token: "tok", pref });
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
