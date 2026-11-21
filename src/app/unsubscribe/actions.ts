"use server";

import { setPreference, type PreferenceResult } from "./apply";
import { parsePreference, type UnsubscribablePreference } from "./preference";

export type ConfirmState = { status: "idle" | "done" | "didnt_work" };

/**
 * The two server actions of /unsubscribe. Both take only the token (there is no session here, deliberately) and return a plain value rather than the row, so nothing about who the token belongs to
 * reaches the browser. The RPC dispatch is in apply.ts, shared with the one-click POST route.
 *
 * `confirmUnsubscribeAction` is the unsubscribe itself: a GET on the link only shows a confirm page (UNSUB-GET-SCANNER-1), because mail clients and link scanners open every link in a message, and
 * the button is a POST. `resubscribeAction` is the undo, with the same token.
 *
 * `preference` picks which of the independently-flippable columns this changes, and therefore which RPC; see 0128 (send-138's alert has its own column and function), 0197 (send-466), 0200 (send-467).
 */
export async function confirmUnsubscribeAction(token: string, preference: UnsubscribablePreference): Promise<PreferenceResult> {
  return setPreference(token, preference, false, "unsubscribe");
}

/**
 * The confirm button's form action. A real <form> posts the token and the kind as hidden fields, so it works with JavaScript off (the server renders the page again with the answer); with JavaScript on,
 * React calls it without a reload. It does exactly what `confirmUnsubscribeAction` does. A missing or empty token answers "didnt_work" and calls nothing.
 */
export async function confirmUnsubscribeFormAction(_previous: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = String(formData.get("token") ?? "");
  const preference = parsePreference(String(formData.get("pref") ?? ""));
  return { status: (await confirmUnsubscribeAction(token, preference)) === "done" ? "done" : "didnt_work" };
}

export async function resubscribeAction(token: string, preference: UnsubscribablePreference): Promise<boolean> {
  return (await setPreference(token, preference, true, "resubscribe")) === "done";
}
