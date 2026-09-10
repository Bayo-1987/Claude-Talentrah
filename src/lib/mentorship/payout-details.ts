"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listNigerianBanks, resolveAccountNumber, createTransferRecipient, isDecline } from "@/lib/paystack/client";

/**
 * Bank-detail collection for mentor payouts (0149). Lives alongside
 * AvailabilityManager on the mentor's own apply/cockpit page
 * (src/app/(app)/mentorship/apply/page.tsx) rather than a separate settings
 * route — both are "things an APPROVED mentor configures about themselves,"
 * the exact same gate the page already applies to AvailabilityManager, and a
 * mentor has no more reason to hunt through a general Settings page for
 * payout details than for their open slots.
 *
 * THE ORDER IS THE WHOLE POINT, per this task's own brief: resolve the
 * account name via Paystack BEFORE persisting anything, never trust a
 * free-typed name. This function is also the only writer of
 * mentor_profiles.payout_* — none of those columns are in the authenticated
 * UPDATE grant (0149's own header), so a mentor cannot bypass this by
 * PATCHing the table directly even if they tried.
 */
export interface BankListState {
  status: "idle" | "error";
  message: string;
}

export async function listBanksForForm() {
  try {
    return { banks: await listNigerianBanks(), error: null as string | null };
  } catch {
    return { banks: [], error: "Could not load the bank list — try again shortly." };
  }
}

export interface SavePayoutDetailsState {
  status: "idle" | "success" | "error";
  message: string;
}

export async function saveMentorPayoutDetailsAction(
  _prev: SavePayoutDetailsState,
  formData: FormData,
): Promise<SavePayoutDetailsState> {
  const { user } = await requireUser();
  const bankCode = String(formData.get("bankCode") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();

  if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
    return { status: "error", message: "Pick a bank and enter a 10-digit account number." };
  }

  const serviceClient = createServiceRoleClient();

  // Only an approved mentor may set payout details — matches the row this
  // whole feature is for existing at all.
  const { data: mentor } = await serviceClient
    .from("mentor_profiles")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (mentor?.status !== "approved") {
    return { status: "error", message: "Only approved mentors can set payout details." };
  }

  let resolved;
  try {
    resolved = await resolveAccountNumber({ accountNumber, bankCode });
  } catch (err) {
    return {
      status: "error",
      message: isDecline(err)
        ? "Couldn't verify that account — check the bank and account number."
        : "Paystack is unavailable right now — try again shortly.",
    };
  }

  let recipient;
  try {
    recipient = await createTransferRecipient({
      name: resolved.account_name,
      accountNumber,
      bankCode,
    });
  } catch {
    return { status: "error", message: "Couldn't register that account for payouts — try again shortly." };
  }

  const { error } = await serviceClient
    .from("mentor_profiles")
    .update({
      payout_bank_code: bankCode,
      payout_account_number: accountNumber,
      payout_account_name: resolved.account_name,
      payout_recipient_code: recipient.recipient_code,
      payout_bank_verified_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) return { status: "error", message: "Something went wrong on our end." };

  revalidatePath("/mentorship/apply");
  return { status: "success", message: `Confirmed — payouts go to ${resolved.account_name}.` };
}
