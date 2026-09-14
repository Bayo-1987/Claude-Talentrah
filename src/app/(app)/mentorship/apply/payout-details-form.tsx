"use client";

import { useActionState } from "react";
import { saveMentorPayoutDetailsAction, type SavePayoutDetailsState } from "@/lib/mentorship/payout-details";
import { TextField, SelectField, Button, BorderedCard } from "@/components/ui";
import type { OwnPayoutDetails } from "@/lib/mentorship/queries";
import type { PaystackBank } from "@/lib/paystack/client";

const initialState: SavePayoutDetailsState = { status: "idle", message: "" };

export function PayoutDetailsForm({
  existing,
  banks,
  banksError,
}: {
  existing: OwnPayoutDetails | null;
  banks: PaystackBank[];
  banksError: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveMentorPayoutDetailsAction, initialState);

  return (
    <BorderedCard className="flex flex-col gap-4 p-5">
      <h2 className="font-display text-[18px] font-semibold">Payout details</h2>
      {existing?.verifiedAt ? (
        <p className="text-[13.5px] text-ink-soft">
          Payouts go to <strong className="text-ink">{existing.accountName}</strong>. Save again to change it.
        </p>
      ) : (
        <p className="text-[13.5px] text-ink-soft">
          Add the bank account your session payouts should go to. We confirm the account name with your bank
          before saving it — never typed in by hand.
        </p>
      )}

      {banksError ? (
        <p className="text-[13px] text-rust">{banksError}</p>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          <SelectField
            label="Bank"
            name="bankCode"
            required
            defaultValue={existing?.bankCode ?? ""}
            options={banks.map((b) => ({ value: b.code, label: b.name }))}
          />
          <TextField
            label="Account number"
            name="accountNumber"
            inputMode="numeric"
            pattern="\d{10}"
            maxLength={10}
            defaultValue={existing?.accountNumber ?? ""}
            placeholder="10-digit NUBAN"
            required
          />

          {state.message && (
            <p className={`text-[13px] ${state.status === "error" ? "text-rust" : "text-green"}`}>{state.message}</p>
          )}

          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Confirming…" : "Confirm account"}
          </Button>
        </form>
      )}
    </BorderedCard>
  );
}
