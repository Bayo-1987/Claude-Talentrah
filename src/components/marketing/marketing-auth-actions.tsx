import Link from "next/link";
import { buttonClasses } from "@/components/ui";

/**
 * The masthead's right-hand actions (HWR-2).
 *
 * `signedIn` is `null` until the browser has read the session and `false` for a visitor without one: BOTH render the exact markup that shipped before HWR-2
 * ("Log in" and "Get started for free"), because that is what the server renders and what every pre-rendered info page serves (pinned byte for byte in
 * tests/marketing/marketing-masthead-signed-out-bytes.test.tsx). Only `true`, which can only happen after hydration, replaces the two with one "Go to your dashboard" link:
 * a signed-in person used to get two buttons that bounced them straight back. The link goes to /dashboard, which chooses the employer or seeker home when it is clicked,
 * so the info pages do no server work per request for this.
 */
export function MarketingAuthActions({ signedIn, loginHref, signupHref }: { signedIn: boolean | null; loginHref: string; signupHref: string }) {
  if (signedIn === true) {
    return (
      <div className="flex items-center gap-4 max-sm:gap-2">
        <Link
          href="/dashboard"
          className={buttonClasses("primary", "md", "min-h-11 px-[22px] py-[11px] text-[14px] whitespace-nowrap no-underline max-sm:px-4 max-sm:py-2.5")}
        >
          Go to your dashboard
        </Link>
      </div>
    );
  }
  return (
        <div className="flex items-center gap-4 max-sm:gap-2">
          <Link href={loginHref} className={buttonClasses("ghost", "md", "whitespace-nowrap no-underline")}>
            Log in
          </Link>
          <Link
            href={signupHref}
            aria-label="Get started for free"
            className={buttonClasses(
              "primary",
              "md",
              "min-h-11 px-[22px] py-[11px] text-[14px] whitespace-nowrap no-underline max-sm:px-4 max-sm:py-2.5",
            )}
          >
            {/*
              Below 640px the full label does not fit beside the logo, the menu and Log in (a 390px
              phone has 350px of content once the bar's side padding is taken off; the full CTA alone
              is 193px), and it used to wrap onto up to four lines and spill out of the 78px bar. So
              the VISIBLE label is shortened there and the link keeps its full accessible name via
              aria-label: the visible words are the start of the name (WCAG 2.5.3, label in name),
              and the hidden-from-AT span means a screen reader never hears both.
            */}
            <span className="max-sm:hidden">Get started for free</span>
            <span className="sm:hidden" aria-hidden="true">
              Get started
            </span>
          </Link>
        </div>
  );
}
