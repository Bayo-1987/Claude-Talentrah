"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export type ShareChannel = "whatsapp" | "copy_link" | "email" | "social";

export interface ShareButtonsProps {
  /** What gets shared. Named `url`, not `referralUrl` — this serves jobs too. */
  url: string;
  /** Compact variant — WhatsApp, copy, email. No social, no funnel chrome. */
  compact?: boolean;
  /** Overrides the referral pitch. A job share is not a referral pitch. */
  message?: string;
  /** Email subject line. Defaults to the referral invite.  */
  subject?: string;
  /**
   * Called per channel, by the CALLER, so logging is opt-in rather than baked
   * in.
   *
   * This used to call `logShareAction` directly, which writes to
   * `referral_shares`. That table is the referral FUNNEL — invited → signed up
   * → activated → reward — and a job share is not a step in it. Logging one
   * there would inflate a metric people are paid against and corrupt the only
   * record of how referrals actually perform. Making the caller pass the
   * logger means a new caller cannot pollute the funnel by forgetting a flag;
   * it has to opt in.
   */
  onShare?: (channel: ShareChannel) => void;
}

const REFERRAL_MESSAGE =
  "I've been using Talentrah to find jobs faster — thought you'd want in too:";

export function ShareButtons({
  url: referralUrl,
  compact = false,
  message = REFERRAL_MESSAGE,
  subject = "Join me on Talentrah",
  onShare,
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onShare?.("copy_link");
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${message} ${referralUrl}`)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${message}\n\n${referralUrl}`)}`;
  // Generic-social surface: a static share-intent link needs no client JS
  // and no browser-capability detection (unlike the Web Share API, which
  // isn't even available on most desktop browsers) — matches the same
  // zero-JS pattern as the WhatsApp/email links.
  const socialHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(referralUrl)}`;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onShare?.("whatsapp")}
        className="inline-flex min-h-11 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
      >
        Share on WhatsApp
      </a>
      <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
        {copied ? "Link copied" : "Copy link"}
      </Button>
      <a
        href={emailHref}
        onClick={() => onShare?.("email")}
        className="inline-flex min-h-11 items-center px-3.5 font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
      >
        Email
      </a>
      {/* Social stays out of compact — a job card has no room for a fourth. */}
      {!compact && (
        <>
          <a
            href={socialHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onShare?.("social")}
            className="inline-flex min-h-11 items-center px-3.5 font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Share elsewhere
          </a>
        </>
      )}
    </div>
  );
}
