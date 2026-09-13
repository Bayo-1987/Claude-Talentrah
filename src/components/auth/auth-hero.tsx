import Link from "next/link";
import { EyebrowLabel, Card } from "@/components/ui";

/**
 * Fictional persona, per build-prompt open decision #2 — the reference
 * design used a real public figure's name here, which would imply a false
 * endorsement. Invented from scratch, not adapted from anyone real.
 */
const TESTIMONIAL = {
  quote:
    "Farah showed me exactly why my resume wasn't landing interviews — then fixed it in one sitting. I had three interviews booked within two weeks.",
  name: "Amaka O.",
  role: "Product Manager, Lagos",
};

export function AuthHero() {
  return (
    <div className="flex h-full flex-col justify-between bg-ink p-10 text-bg md:p-14">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
        <img
          src="/talentrah-mark-reversed.svg"
          alt=""
          width={100}
          height={100}
          className="h-7 w-7 flex-shrink-0"
        />
        <span className="font-display text-[24px] font-medium tracking-tight text-bg">
          Talentrah
        </span>
      </Link>

      <div className="flex flex-col gap-6">
        <h1 className="font-display text-[34px] leading-tight text-bg">
          Talk to Farah. See exactly how well you match a job.
        </h1>
        <p className="max-w-[420px] text-[15px] text-[oklch(80%_0.015_40)]">
          Paste a job link or description and get your match score, what&apos;s
          missing, and a tailored resume — free, no account needed to preview.
        </p>
      </div>

      {/*
        A dark inset panel on a dark hero, not the ambient card look: no
        shadow (it wouldn't read against --ink) and a background tint just
        lighter than the hero's own --ink, same relationship the old
        Editorial version had — just recomputed at Sunbird's ink hue (30)
        instead of Editorial's (50).
      */}
      <Card
        shadow={false}
        className="max-w-[420px] p-5"
        style={{ backgroundColor: "oklch(26% 0.02 30)" }}
      >
        <EyebrowLabel size="sm">What job seekers say</EyebrowLabel>
        <p
          className="mt-3 font-display text-[16px] italic leading-relaxed"
          style={{ color: "var(--bg)" }}
        >
          &ldquo;{TESTIMONIAL.quote}&rdquo;
        </p>
        <p className="mt-3 text-[13px]" style={{ color: "oklch(75% 0.015 40)" }}>
          {TESTIMONIAL.name} — {TESTIMONIAL.role}
        </p>
      </Card>
    </div>
  );
}
