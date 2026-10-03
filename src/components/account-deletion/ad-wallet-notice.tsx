import { adWalletNotice } from "@/lib/account-deletion/copy";

/**
 * What happens to the ad wallet of an organisation the person is the only member of: it stays with the organisation and nothing forfeits it. Shown, with
 * the balance, before they ask and again at the confirm step, and said again in the emails; nothing when the wallet is empty.
 */
export function AdWalletNotice({ balanceNgn }: { balanceNgn: number }) {
  if (balanceNgn <= 0) return null;
  return <p className="font-body text-[13.5px] text-ink">{adWalletNotice(balanceNgn)}</p>;
}
