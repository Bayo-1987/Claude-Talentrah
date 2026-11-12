import { buttonClasses } from "@/lib/button-classes";
import { CARD_PRIMARY_LINK_CLASS } from "@/components/jobs/apply-by-email";

/**
 * "Apply on company site" for a job whose employer chose "On our career site" (PR-E4). A plain anchor to the redirect route (/jobs/{id}/go), never to the stored address: the address is not
 * selectable by any API role, so it is not in the page, the card, the markup or the client bundle; only the host is, shown as "Opens {host}". The route re-checks the link before it redirects.
 *
 * It opens a new tab (target=_blank) with rel noopener noreferrer nofollow, and its accessible name says so. The sponsored-click attribute is the same delegated one the company-site anchor has.
 * It is its own component and does not touch the "Apply by email" control (apply-by-email-card.tsx): an employer's job takes one method or the other.
 */
export function ApplyOnCompanySite({
  jobId,
  host,
  variant,
  sponsored = false,
}: {
  jobId: string;
  host: string;
  variant: "page" | "card";
  sponsored?: boolean;
}) {
  if (!jobId || !host) return null;
  const className = variant === "card" ? CARD_PRIMARY_LINK_CLASS : buttonClasses("primary", "sm", "no-underline");
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <a
        href={`/jobs/${jobId}/go`}
        target="_blank"
        rel="noopener noreferrer nofollow"
        aria-label={`Apply on company site (opens ${host} in a new tab)`}
        data-ad-click={sponsored ? "true" : undefined}
        className={className}
      >
        Apply on company site
      </a>
      <span className="font-body text-[12px] text-ink-soft">Opens {host}</span>
    </span>
  );
}
