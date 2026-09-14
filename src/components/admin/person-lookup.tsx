"use client";

import { useActionState } from "react";
import { lookUpPersonAction } from "@/lib/admin/finance/actions";
import { initialPersonLookupState } from "@/lib/admin/finance/state";
import { Button, TextField, BorderedCard, EyebrowLabel } from "@/components/ui";

const naira = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    currency === "NGN" ? minor / 100 : minor / 100,
  );

/**
 * The search box and the one record it can return.
 *
 * Empty until searched, and it renders AT MOST ONE PERSON — there is no list
 * view behind this, no "recent lookups", and no pagination, because none of
 * those can exist without a way to enumerate. The absence is the feature.
 */
export function PersonLookup() {
  const [state, formAction, pending] = useActionState(
    lookUpPersonAction,
    initialPersonLookupState,
  );
  const person = state.person;

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[320px] flex-1">
            <TextField
              id="person-term"
              label="Email, user id, or Paystack reference"
              name="term"
              autoComplete="off"
              placeholder="someone@example.com"
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Looking up…" : "Look up"}
          </Button>
        </div>
        <p className="font-display text-[13.5px] italic text-ink-soft">
          Exact matches only — no partial or wildcard search, and no way to list
          people. You need one of the three identifiers for the person you are
          looking for.
        </p>
      </form>

      {state.status === "not_found" && (
        <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[14px]">
          {state.message}
        </p>
      )}
      {state.status === "error" && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[14px] text-rust">
          {state.message}
        </p>
      )}

      {person && (
        <div className="flex flex-col gap-5">
          <BorderedCard className="flex flex-col gap-1.5 p-5">
            <EyebrowLabel>Account</EyebrowLabel>
            <p className="font-display text-[20px]">
              {[person.firstName, person.lastName].filter(Boolean).join(" ") || person.email}
            </p>
            <p className="text-[14px] text-ink-soft">{person.email}</p>
            <p className="text-[13.5px] text-ink-soft">
              {person.country ?? "country not set"} · joined{" "}
              {new Date(person.createdAt).toLocaleDateString()} ·{" "}
              <span className="font-semibold text-ink">{person.creditsBalance} credits</span>
            </p>
            <p className="font-mono text-[12px] text-ink-soft">{person.id}</p>
          </BorderedCard>

          <section className="flex flex-col gap-2">
            <EyebrowLabel>Payments</EyebrowLabel>
            {person.payments.length === 0 ? (
              <p className="font-display text-[14px] italic text-ink-soft">No payments.</p>
            ) : (
              <BorderedCard className="overflow-x-auto p-0">
                <table className="w-full border-collapse text-[13.5px]">
                  <tbody>
                    {person.payments.map((p) => (
                      <tr key={p.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5">{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5">{p.productType}</td>
                        <td className="px-4 py-2.5">{naira(p.amount, p.currency)}</td>
                        <td className="px-4 py-2.5">
                          {p.rail}
                          {p.channel && ` · ${p.channel}`}
                        </td>
                        <td
                          className={
                            "px-4 py-2.5 " + (p.status === "pending" ? "font-semibold text-rust" : "")
                          }
                        >
                          {p.status}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11.5px] text-ink-soft">
                          {p.reference ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </BorderedCard>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <EyebrowLabel>Passes</EyebrowLabel>
            {person.passes.length === 0 ? (
              <p className="font-display text-[14px] italic text-ink-soft">No passes.</p>
            ) : (
              <ul className="flex list-none flex-col gap-2 p-0">
                {person.passes.map((p) => (
                  <li key={p.id}>
                    <BorderedCard className="flex flex-col gap-1 p-4 text-[13.5px]">
                      <span>
                        {p.status}
                        {p.autoRenewStatus && ` · auto-renew ${p.autoRenewStatus}`} · expires{" "}
                        {new Date(p.expiresAt).toLocaleDateString()}
                      </span>
                      {p.pendingRenewalReference && (
                        /*
                          The link back to M5. A pending reference here is the
                          same "charge of unknown outcome" the ops screen
                          surfaces in aggregate — this is the per-person view of
                          it, and it is often exactly why the person wrote in.
                        */
                        <span className="font-semibold text-rust">
                          Renewal outcome unknown — attempt {p.renewalAttemptCount}, reference{" "}
                          <span className="font-mono text-[12px]">{p.pendingRenewalReference}</span>
                        </span>
                      )}
                    </BorderedCard>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <EyebrowLabel>Credit ledger</EyebrowLabel>
            {person.credits.length === 0 ? (
              <p className="font-display text-[14px] italic text-ink-soft">No credit movements.</p>
            ) : (
              <BorderedCard className="overflow-x-auto p-0">
                <table className="w-full border-collapse text-[13.5px]">
                  <tbody>
                    {person.credits.map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2.5">{new Date(c.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5">{c.reason}</td>
                        <td className="px-4 py-2.5">
                          {c.delta > 0 ? `+${c.delta}` : c.delta}
                        </td>
                        <td className="px-4 py-2.5 text-ink-soft">balance {c.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </BorderedCard>
            )}
          </section>

          <p className="font-display text-[13.5px] italic text-ink-soft">
            Billing records only. Resumes, tailoring history, applications and feedback are
            deliberately not shown here and are not fetched — none of them answer a billing
            question, and showing them would be a privacy decision made by accident.
          </p>
        </div>
      )}
    </div>
  );
}
