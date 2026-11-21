/**
 * UNSUB-GET-SCANNER-1: a GET on /unsubscribe only SHOWS a confirm page; only a POST changes anything. Mail clients and link scanners open every link in a message, so a link that unsubscribes on GET
 * unsubscribes people who never asked. Two ways in, both POSTs: the confirm button (a server action) and the one-click endpoint POST /api/unsubscribe (RFC 8058, what a mail client's own "Unsubscribe"
 * button calls). Old links (`/unsubscribe?token=..[&pref=..]`) keep working and now land on the confirm page.
 *
 * No hand-written module factory: the service-role client is replaced with vi.spyOn on the real module's export. The page is called as a function and its element tree read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import * as serviceRole from "@/lib/supabase/service-role";
import { NOTIFICATION_RPCS } from "@/lib/notifications/contract-db";

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let result: { data: Array<{ matched: boolean }> | null; error: { message: string } | null } = { data: [{ matched: true }], error: null };

beforeEach(() => {
  calls.length = 0;
  result = { data: [{ matched: true }], error: null };
  vi.spyOn(serviceRole, "createServiceRoleClient").mockReturnValue({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return result;
    },
  } as never);
});
afterEach(() => vi.restoreAllMocks());

import UnsubscribePage from "@/app/unsubscribe/page";
import { confirmUnsubscribeFormAction } from "@/app/unsubscribe/actions";
import { ConfirmUnsubscribe } from "@/app/unsubscribe/confirm-unsubscribe";
import { COPY } from "@/app/unsubscribe/copy";
import { handleOneClickUnsubscribe } from "@/app/unsubscribe/one-click";
import { parsePreference, type UnsubscribablePreference } from "@/app/unsubscribe/preference";

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
const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const SIX: Array<[string | undefined, UnsubscribablePreference]> = [
  [undefined, "job_match_digest"],
  ["job_match_digest", "job_match_digest"],
  ["proactive_match_alert", "proactive_match_alert"],
  ["scholarship_deadline_alert", "scholarship_deadline_alert"],
  ["win_back_email", "win_back_email"],
  ["announcements", "announcements"],
  ["promotions", "promotions"],
];

describe("a GET changes nothing", () => {
  it.each(SIX)("pref=%j: no database call, a confirm button for the right kind, and the old link shape still lands here", async (pref, kind) => {
    const tree = await open({ token: "tok", pref });
    expect(calls).toEqual([]);
    expect(findProps(tree, "ConfirmUnsubscribe")).toMatchObject({ token: "tok", preference: kind });
    expect(COPY[kind].confirm.heading.length).toBeGreaterThan(10);
    expect(words(tree)).not.toContain("You're unsubscribed.");
  });

  it("every kind asks its own question (a wrong-kind mix-up would show)", () => {
    const kinds: UnsubscribablePreference[] = ["job_match_digest", "proactive_match_alert", "scholarship_deadline_alert", "win_back_email", "announcements", "promotions"];
    expect(new Set(kinds.map((k) => COPY[k].confirm.heading)).size).toBe(kinds.length);
  });

  it("the page source holds no database call and no service-role client at all (a GET handler that could unsubscribe is the bug)", () => {
    const page = src("src/app/unsubscribe/page.tsx");
    expect(page).not.toMatch(/\.rpc\s*\(/);
    expect(page).not.toMatch(/createServiceRoleClient/);
    expect(page).not.toMatch(/setPreference|confirmUnsubscribeAction/);
  });

  it("no token: the 'didn't work' words and no confirm button", async () => {
    const tree = await open({});
    expect(calls).toEqual([]);
    expect(words(tree)).toContain("That link didn't work.");
    expect(findProps(tree, "ConfirmUnsubscribe")).toBeNull();
  });
});

describe("the confirm works with JavaScript off: a real <form> whose action is the server action", () => {
  const c = src("src/app/unsubscribe/confirm-unsubscribe.tsx");
  const html = renderToStaticMarkup(createElement(ConfirmUnsubscribe, { token: "tok-123", preference: "promotions" }));

  it("the server-rendered HTML holds a form with an action, the token and the kind as hidden fields, and a submit button", () => {
    expect(html).toMatch(/<form[^>]*\saction=/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="token"[^>]*value="tok-123"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="pref"[^>]*value="promotions"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Unsubscribe<\/button>/);
  });

  it("the button needs no script: no click handler is how it works (a form submit does)", () => {
    expect(c).not.toMatch(/onClick/);
  });

  it("is a client component whose form action comes from useActionState on the server action", () => {
    expect(c).toMatch(/^"use client";/);
    expect(c).toMatch(/useActionState(?:<[^>]*>)?\(\s*confirmUnsubscribeFormAction/);
    expect(c).toMatch(/<form\s+action=\{formAction\}/);
  });

  it("the done state shows the 'You're unsubscribed.' copy and the undo for the same token and kind; unmatched and failed show the 'didn't work' copy", () => {
    expect(c).toMatch(/<ResubscribeButton\s+token=\{token\}\s+preference=\{preference\}\s*\/>/);
    expect(c).toMatch(/COPY\[preference\]\.unsubscribed/);
    expect(c).toMatch(/NOT_WORKING_COPY/);
  });

  it("the form action reads the token and the kind from the submitted form, and does exactly what the confirm action does", async () => {
    const form = new FormData();
    form.set("token", "tok");
    form.set("pref", "announcements");
    expect(await confirmUnsubscribeFormAction({ status: "idle" }, form)).toEqual({ status: "done" });
    expect(calls).toEqual([{ name: NOTIFICATION_RPCS.emailUnsubscribeStream, args: { p_token: "tok", p_stream: "announcements", p_subscribed: false } }]);
    result = { data: [{ matched: false }], error: null };
    expect(await confirmUnsubscribeFormAction({ status: "idle" }, form)).toEqual({ status: "didnt_work" });
    const empty = new FormData();
    calls.length = 0;
    expect(await confirmUnsubscribeFormAction({ status: "idle" }, empty)).toEqual({ status: "didnt_work" });
    expect(calls).toEqual([]);
  });
});

function post(query: string, body: string | null = "List-Unsubscribe=One-Click", method = "POST") {
  return new Request(`https://www.example.test/api/unsubscribe${query}`, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, ...(body === null ? {} : { body }) });
}

describe("POST /api/unsubscribe (one-click, RFC 8058)", () => {
  it.each([
    [undefined, "email_unsubscribe", { p_token: "tok", p_subscribed: false }],
    ["proactive_match_alert", "proactive_match_alert_set_preference", { p_token: "tok", p_enabled: false }],
    ["scholarship_deadline_alert", "scholarship_deadline_alert_set_preference", { p_token: "tok", p_enabled: false }],
    ["win_back_email", "win_back_email_set_preference", { p_token: "tok", p_enabled: false }],
    ["announcements", NOTIFICATION_RPCS.emailUnsubscribeStream, { p_token: "tok", p_stream: "announcements", p_subscribed: false }],
    ["promotions", NOTIFICATION_RPCS.emailUnsubscribeStream, { p_token: "tok", p_stream: "promotions", p_subscribed: false }],
  ])("pref=%j makes exactly one call, the same RPC and arguments as the confirm button, and answers 200", async (pref, rpc, args) => {
    const res = await handleOneClickUnsubscribe(post(`?token=tok${pref ? `&pref=${pref}` : ""}`));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ name: rpc, args }]);
    expect(parsePreference(pref)).toBeDefined();
  });

  it("an old-style link with the token only is the weekly digest", async () => {
    await handleOneClickUnsubscribe(post("?token=tok"));
    expect(calls).toEqual([{ name: "email_unsubscribe", args: { p_token: "tok", p_subscribed: false } }]);
  });

  it("a body that is not the one-click form is refused, and nothing is called", async () => {
    for (const body of [null, "", "hello", "List-Unsubscribe=Other"]) {
      const res = await handleOneClickUnsubscribe(post("?token=tok", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("no token is refused with 400 and nothing is called", async () => {
    expect((await handleOneClickUnsubscribe(post(""))).status).toBe(400);
    expect((await handleOneClickUnsubscribe(post("?token="))).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("a token nothing matches answers 404: the mail client is told it did not work", async () => {
    result = { data: [{ matched: false }], error: null };
    expect((await handleOneClickUnsubscribe(post("?token=stale"))).status).toBe(404);
  });

  it("a database error answers 500, is logged without the token, and says nothing about whose token it was", async () => {
    result = { data: null, error: { message: "boom" } };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleOneClickUnsubscribe(post("?token=secret-token-value"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret-token-value");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token-value");
  });

  it("a GET to the endpoint changes nothing: the route module exports POST and no GET", async () => {
    const mod = await import("@/app/api/unsubscribe/route");
    expect(Object.keys(mod).sort()).toEqual(["POST"]);
    const handler = mod.POST;
    expect(typeof handler).toBe("function");
    expect(calls).toEqual([]);
  });

  it("the handler itself refuses a GET (defence in depth) and calls nothing", async () => {
    const res = await handleOneClickUnsubscribe(post("?token=tok", null, "GET"));
    expect(res.status).toBe(405);
    expect(calls).toEqual([]);
  });
});
