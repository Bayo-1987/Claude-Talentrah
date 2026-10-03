import { requireUser } from "@/lib/auth/require-user";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { visibleName } from "@/lib/profile/name";
import { SettingsForm } from "./settings-form";
import { billingRegionLabel } from "@/lib/billing/region";
import { DeleteAccountSection } from "@/components/account-deletion/delete-account-section";
import { getDeletionBlockers } from "@/lib/account-deletion/queries";
import { SignOutEverywhere } from "./sign-out-everywhere";

export const metadata = { title: "Settings — Talentrah" };

/**
 * The page "View profile" in the Farah panel has been pointing at since that
 * link was written. There was no route under src/app for /settings at all, so
 * it 404'd for every signed-in user on every screen the panel renders on.
 *
 * WHAT IS EDITABLE AND WHY THE REST IS NOT. Checked against production before
 * building: of the six profile columns named in the brief, only four carry an
 * UPDATE grant to `authenticated`, and one of those four is read by nothing.
 *
 *   first_name, last_name, country   editable
 *   email                            0030 — the identity the account is keyed
 *                                    on. Changing it is an auth operation.
 *   market_segment                   0030 — a billing segment nobody
 *                                    self-selects.
 *   locale                           writable, but nothing reads it: every
 *                                    profile is "en" and the masthead's "EN"
 *                                    is a static span. A picker would be a
 *                                    control that does nothing.
 *
 * The three are shown as facts rather than omitted, because "where is my
 * email?" is a worse question than "why can't I change it?", and the second
 * one has an answer printed next to it.
 */
export default async function SettingsPage() {
  const { user, profile } = await requireUser();
  const deletionBlockers = await getDeletionBlockers(user.id);

  const readOnly = [
    {
      label: "Email",
      value: profile.email,
      note: "Your account is keyed on this address, so it can't be changed here.",
    },
    {
      label: "Billing region",
      // Named from the country, in the words of the real billing path (src/lib/billing/region.ts). The segment is not
      // shown: billing never reads it (every purchase is in naira through Paystack), so the old segment label told nobody anything.
      value: billingRegionLabel(profile.country),
      note: "Everything on Talentrah is charged in naira (₦) through Paystack. This is what that means for your country.",
    },
    {
      label: "Language",
      value: profile.locale === "en" ? "English" : profile.locale,
      note: "English only for now — there is nothing else to switch to yet.",
    },
  ];

  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Settings</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Your profile</h1>
      </div>

      <BorderedCard className="p-6">
        <SettingsForm
          firstName={visibleName(profile.first_name)}
          lastName={visibleName(profile.last_name)}
          country={profile.country}
        />
      </BorderedCard>

      <div className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Not editable here</EyebrowLabel>
        {readOnly.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5 border-b border-line pb-3">
            <span className="font-body text-[13px] font-semibold text-ink-soft">{row.label}</span>
            <span className="font-body text-[15px] text-ink">{row.value}</span>
            <span className="font-display text-[13px] italic text-ink-soft">{row.note}</span>
          </div>
        ))}
      </div>

      <SignOutEverywhere />
      <DeleteAccountSection creditsBalance={Math.max(profile.credits_balance, 0)} blockers={deletionBlockers} />
    </div>
  );
}
