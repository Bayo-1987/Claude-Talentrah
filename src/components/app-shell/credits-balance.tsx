"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * The credit balance the masthead shows, kept in step with what the Farah panel just spent.
 *
 * WHY THIS EXISTS (issue #605). The masthead's balance is a server-rendered prop
 * (`profile.credits_balance`, read when the page loaded). A paid Farah message spends a credit AFTER
 * that, inside a fetch the page never re-reads, so the pill kept showing the pre-charge number until the
 * next navigation — while the ledger and the profile row already said one less. Display only; nothing
 * about charging is involved.
 *
 * THE RULE: show the balance the panel reported only while the server value is still the one it was
 * reported against (`base`). The moment the server hands down a different number — a navigation, a
 * top-up, a spend in another tab — the server wins, so a stale client value can never outlive fresher
 * server truth. That is why the override carries its `base` rather than just a value, and why this is a
 * pure function: it is the whole decision, and it is unit-tested without a DOM.
 */
export interface CreditsOverride {
  base: number;
  value: number;
}

export function displayedCreditsBalance(serverBalance: number, override: CreditsOverride | null): number {
  return override && override.base === serverBalance ? override.value : serverBalance;
}

interface Ctx {
  /** What the server last rendered into this shell. */
  serverBalance: number;
  override: CreditsOverride | null;
  report: (newBalance: number) => void;
}

const CreditsBalanceContext = createContext<Ctx | null>(null);

export function CreditsBalanceProvider({ serverBalance, children }: { serverBalance: number; children: React.ReactNode }) {
  const [override, setOverride] = useState<CreditsOverride | null>(null);
  // Bound to the CURRENT server value at report time, so the override expires when that value changes.
  const report = useCallback((value: number) => setOverride({ base: serverBalance, value }), [serverBalance]);
  const ctx = useMemo(() => ({ serverBalance, override, report }), [serverBalance, override, report]);
  return <CreditsBalanceContext.Provider value={ctx}>{children}</CreditsBalanceContext.Provider>;
}

/**
 * The balance to display. Outside a provider (a test, a storybook, any page that renders the masthead on
 * its own) it is just the prop it was handed, exactly as before.
 */
export function useDisplayedCreditsBalance(serverBalance: number): number {
  const ctx = useContext(CreditsBalanceContext);
  return displayedCreditsBalance(serverBalance, ctx?.override ?? null);
}

/** Tell the masthead the account's new balance. A no-op outside a provider. */
export function useReportCreditsBalance(): (newBalance: number) => void {
  return useContext(CreditsBalanceContext)?.report ?? noop;
}
const noop = () => {};
