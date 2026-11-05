import { buttonClasses } from "@/lib/button-classes";
import { applyEmailHref } from "@/lib/jobs/apply-email";
import { CopyAddressButton } from "@/components/jobs/copy-address-button";

/**
 * "Apply by email" for a posting that has an address and (maybe) no company link: the one shared piece the job page and the feed card both render.
 * The decision (which of link / address to show) stays with the caller, because each caller already owns its own link markup and its own order of controls;
 * this file only draws the address side, from an address the caller got out of normaliseApplyEmail (never the raw stored value).
 *
 * Talentrah does not send this email and does not attach the seeker's resume; the copy says so. The link is a plain mailto: anchor, so it opens the seeker's own mail app.
 */

/** The feed card's primary button, byte for byte the class string job-card.tsx puts on "Apply on company site", so the two look and size the same. */
export const CARD_PRIMARY_LINK_CLASS =
  "inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust";
/** The feed card's secondary choice when a company link is the primary button: a quiet underlined text link, like "Mark as applied". */
export const CARD_SECONDARY_LINK_CLASS =
  "inline-flex min-h-10 items-center text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust";

interface ApplyByEmailLinkProps {
  /** The NORMALISED address (normaliseApplyEmail). */
  address: string;
  title: string;
  variant: "page" | "card";
  /** True when a company link is already the primary button: this one then reads "Or apply by email". */
  secondary?: boolean;
  /** A sponsored card: the same delegated click tracking the company-site anchor has (promoted-click-tracker.tsx). */
  sponsored?: boolean;
}

/** The mailto anchor (and, on the job page, the Copy address button). Renders nothing if the address is somehow refused. */
export function ApplyByEmailLink({ address, title, variant, secondary = false, sponsored = false }: ApplyByEmailLinkProps) {
  const href = applyEmailHref(address, title);
  if (href === null) return null;
  const label = secondary ? "Or apply by email" : "Apply by email";
  const adClick = sponsored ? "true" : undefined;

  if (variant === "card") {
    return (
      <a href={href} data-ad-click={adClick} className={secondary ? CARD_SECONDARY_LINK_CLASS : CARD_PRIMARY_LINK_CLASS}>
        {label}
      </a>
    );
  }
  return (
    <>
      <a href={href} className={buttonClasses(secondary ? "secondary" : "primary", "sm", "no-underline")}>
        {label}
      </a>
      <CopyAddressButton address={address} />
    </>
  );
}

/**
 * The job page's note under the buttons: what Talentrah does and does not do. It never prints the address (the owner's decision): the address is behind "Apply by email" (a mailto link) and
 * "Copy address", and nowhere else on the page.
 */
export function ApplyByEmailNote() {
  return (
    <p className="basis-full max-w-[520px] border border-dashed border-line p-3 text-[13px] text-ink-soft">
      Use Apply by email to open your mail app, or Copy address to paste it elsewhere, then send your resume. Talentrah does not send this email or attach your resume.
    </p>
  );
}
