/**
 * send-485 (issue #605) — which credit balance the masthead shows.
 *
 * The server renders `profile.credits_balance` into the masthead at page load. A paid Farah message
 * spends a credit AFTER that, in a fetch the page never re-reads, so the panel reports the new balance
 * and the masthead shows it in place of the stale one. The rule is a pure function so it can be pinned
 * without a DOM (this repo's unit environment is plain Node):
 *
 *   show the reported balance only while the server value is still the one it was reported against.
 *
 * The moment the server hands down a DIFFERENT number — a navigation, a top-up, a spend elsewhere — the
 * server wins, so a stale client value can never outlive fresher server truth.
 */
import { describe, expect, it } from "vitest";
import { displayedCreditsBalance } from "@/components/app-shell/credits-balance";

describe("displayedCreditsBalance", () => {
  it("shows the server balance when nothing has been reported", () => {
    expect(displayedCreditsBalance(41, null)).toBe(41);
  });

  it("shows the reported balance while the server value is the one it was reported against (41 -> 40)", () => {
    expect(displayedCreditsBalance(41, { base: 41, value: 40 })).toBe(40);
  });

  it("hands over to the server as soon as the server value changes (a navigation re-rendered it at 40)", () => {
    expect(displayedCreditsBalance(40, { base: 41, value: 40 })).toBe(40);
  });

  it("does not let a stale reported value hide a top-up: server moved to 140, reported value dropped", () => {
    expect(displayedCreditsBalance(140, { base: 41, value: 40 })).toBe(140);
  });

  it("keeps the reported value when a cached page re-renders with the same old server number", () => {
    expect(displayedCreditsBalance(41, { base: 41, value: 39 })).toBe(39);
  });
});
