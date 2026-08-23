"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { logShareAction } from "@/lib/referrals/actions";

export interface ShareButtonsProps {
  referralUrl: string;
  /** Compact variant for the Hired banner — WhatsApp + copy only, no funnel chrome. */
  compact?: boolean;
}

const SHARE_MESSAGE =
  "I've been using Talentrah to find jobs faster — thought you'd want in too:";

export function ShareButtons({ referralUrl, compact = false }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    void logShareAction("copy_link");
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${SHARE_MESSAGE} ${referralUrl}`)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent("Join me on Talentrah")}&body=${encodeURIComponent(`${SHARE_MESSAGE}\n\n${referralUrl}`)}`;
  // Generic-social surface: a static share-intent link needs no client JS
  // and no browser-capability detection (unlike the Web Share API, which
  // isn't even available on most desktop browsers) — matches the same
  // zero-JS pattern as the WhatsApp/email links.
  const socialHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_MESSAGE)}&url=${encodeURIComponent(referralUrl)}`;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => void logShareAction("whatsapp")}
        className="inline-flex min-h-11 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
      >
        Share on WhatsApp
      </a>
      <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
        {copied ? "Link copied" : "Copy link"}
      </Button>
      {!compact && (
        <>
          <a
            href={emailHref}
            onClick={() => void logShareAction("email")}
            className="inline-flex min-h-11 items-center px-3.5 font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Email
          </a>
          <a
            href={socialHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void logShareAction("social")}
            className="inline-flex min-h-11 items-center px-3.5 font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Share elsewhere
          </a>
        </>
      )}
    </div>
  );
}
